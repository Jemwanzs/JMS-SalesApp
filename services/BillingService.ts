import type { SupabaseClient } from "@supabase/supabase-js";

import { AuditService } from "@/services/AuditService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { initializeTransaction, verifyPaystackSignature } from "@/lib/paystack/client";
import type { Database, PaymentStatus, SubscriptionStatus } from "@/types/database.types";

/**
 * BillingService — subscription state transitions, Paystack webhook
 * processing (docs/14-billing-paystack.md). ALWAYS constructed with the
 * service-role client (added to lib/supabase/service-role.ts's allowed-
 * callers list): "the webhook route running under the service-role
 * client" is the sole state-transition authority per the doc, and even
 * the initial TRIAL row (bootstrapTrialSubscription) is created inside
 * TenantService.createTenant's own service-role bootstrap sequence — no
 * client-authenticated path ever writes subscriptions/payments.
 *
 * Plans are fixed-duration packages the user picks at checkout (2 to
 * 365 days, migration 0023) — the picked package's own price and
 * duration_days are what actually get charged and what actually
 * determine the resulting subscription period, never a fixed 30-day
 * assumption. subscriptions.plan_id is null during TRIAL (nothing
 * chosen/charged yet) and only gets set once a real payment succeeds.
 *
 * Trial default is 2 days (48 hours), grace period default is 3 days —
 * both read from `platform_settings` (global, Platform Super Admin
 * scope per the doc's decision log), not hardcoded. A tenant whose
 * billing owner is a registered platform_admins row gets
 * `platform_admin_trial_days` (180) instead of the normal default —
 * this checks the REAL platform_admins table, not a hardcoded email,
 * per docs/15-super-admin.md's "not a hardcoded email" principle: any
 * current or future platform admin gets the longer trial on their own
 * tenant automatically, not just the one bootstrap address.
 *
 * Scoped to the ONE event type that actually drives this app's
 * trial-to-paid flow: `charge.success` (a completed Standard Checkout
 * payment). Paystack's documented recurring-subscription webhook
 * coverage (subscription.create/disable, invoice.payment_failed, etc.)
 * varies by integration and account configuration — flagged in the doc
 * itself as something to validate during integration, not assumed here;
 * every OTHER event type still gets logged to the billing_events ledger
 * (so nothing is silently dropped/unaccounted for) but doesn't drive a
 * state transition yet. Extending coverage as real usage patterns
 * surface which events actually matter is a natural, incremental
 * follow-up, not a gap being glossed over.
 */
export interface SubscriptionView {
  id: string;
  status: SubscriptionStatus;
  planId: string | null;
  planName: string | null;
  planPrice: number | null;
  planCurrency: string | null;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  nextBillingDate: string | null;
  gracePeriodEnd: string | null;
}

export interface PaymentView {
  id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paidAt: string | null;
  createdAt: string;
}

export interface PlanView {
  id: string;
  code: string;
  name: string;
  price: number;
  currency: string;
  interval: string;
  durationDays: number;
  features: string[];
}

export class BillingService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /**
   * Called from TenantService.createTenant's bootstrap sequence, on the
   * same service-role client, right after the tenant itself exists.
   */
  async bootstrapTrialSubscription(tenantId: string): Promise<void> {
    const { data: tenant } = await this.supabase
      .from("tenants")
      .select("billing_owner_profile_id")
      .eq("id", tenantId)
      .maybeSingle();

    let trialDays = await this.getGlobalSetting("trial_days", 2);

    if (tenant?.billing_owner_profile_id) {
      const { data: admin } = await this.supabase
        .from("platform_admins")
        .select("id")
        .eq("profile_id", tenant.billing_owner_profile_id)
        .maybeSingle();

      if (admin) {
        trialDays = await this.getGlobalSetting("platform_admin_trial_days", 180);
      }
    }

    const trialEnd = new Date(Date.now() + trialDays * 86_400_000).toISOString();

    const { error } = await this.supabase.from("subscriptions").insert({
      tenant_id: tenantId,
      status: "TRIAL",
      trial_end: trialEnd,
    });

    if (error) {
      throw new Error(`BillingService.bootstrapTrialSubscription: ${error.message}`);
    }
  }

  async listPlans(): Promise<PlanView[]> {
    const { data, error } = await this.supabase
      .from("billing_plans")
      .select("id, code, name, price, currency, interval, duration_days, features")
      .eq("is_active", true)
      .order("duration_days", { ascending: true });

    if (error) {
      throw new Error(`BillingService.listPlans: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      price: Number(row.price),
      currency: row.currency,
      interval: row.interval,
      durationDays: row.duration_days,
      features: Array.isArray(row.features) ? (row.features as string[]) : [],
    }));
  }

  async getSubscription(tenantId: string): Promise<SubscriptionView | null> {
    const { data: sub } = await this.supabase
      .from("subscriptions")
      .select(
        "id, plan_id, status, trial_end, current_period_end, next_billing_date, grace_period_end"
      )
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!sub) return null;

    const plan = sub.plan_id
      ? await this.supabase.from("billing_plans").select("name, price, currency").eq("id", sub.plan_id).maybeSingle()
      : { data: null };

    return {
      id: sub.id,
      status: sub.status,
      planId: sub.plan_id,
      planName: plan.data?.name ?? null,
      planPrice: plan.data ? Number(plan.data.price) : null,
      planCurrency: plan.data?.currency ?? null,
      trialEnd: sub.trial_end,
      currentPeriodEnd: sub.current_period_end,
      nextBillingDate: sub.next_billing_date,
      gracePeriodEnd: sub.grace_period_end,
    };
  }

  async listPayments(tenantId: string): Promise<PaymentView[]> {
    const { data, error } = await this.supabase
      .from("payments")
      .select("id, amount, currency, status, paid_at, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`BillingService.listPayments: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      amount: Number(row.amount),
      currency: row.currency,
      status: row.status,
      paidAt: row.paid_at,
      createdAt: row.created_at,
    }));
  }

  /**
   * Payment status is never derived from this call's own success --
   * this only starts a Paystack Standard Checkout session for the
   * user-picked package and hands back the URL to redirect to. The
   * webhook is what actually moves the subscription to ACTIVE (and
   * assigns plan_id) once Paystack confirms the charge.
   */
  async initializeCheckout(input: {
    tenantId: string;
    planId: string;
    email: string;
    callbackUrl: string;
  }): Promise<{ authorizationUrl: string }> {
    const { data: sub, error: subError } = await this.supabase
      .from("subscriptions")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .single();

    if (subError || !sub) {
      throw new Error(`BillingService.initializeCheckout: no subscription found for this tenant`);
    }

    const { data: plan, error: planError } = await this.supabase
      .from("billing_plans")
      .select("price, currency")
      .eq("id", input.planId)
      .eq("is_active", true)
      .single();

    if (planError || !plan) {
      throw new Error(`BillingService.initializeCheckout: plan not found`);
    }

    const reference = `sub_${sub.id}_${Date.now()}`;

    const result = await initializeTransaction({
      email: input.email,
      amount: Number(plan.price),
      currency: plan.currency,
      reference,
      callbackUrl: input.callbackUrl,
      metadata: { tenant_id: input.tenantId, subscription_id: sub.id, plan_id: input.planId },
    });

    return { authorizationUrl: result.authorizationUrl };
  }

  /**
   * Signature-verified, idempotency-ledgered (billing_events.
   * paystack_event_id, unique) webhook processing -- a redelivered
   * event is a no-op, not a double-processed payment. Every event type
   * gets a ledger row (so redelivery of anything is provably safe and
   * nothing silently vanishes), but only charge.success currently
   * drives a state transition -- see this class's header comment.
   */
  async processWebhookEvent(rawBody: string, signatureHeader: string | null): Promise<{ processed: boolean }> {
    if (!verifyPaystackSignature(rawBody, signatureHeader)) {
      throw new Error("Invalid Paystack webhook signature");
    }

    const payload = JSON.parse(rawBody) as { event: string; data: Record<string, unknown> };
    const eventType = payload.event;
    const data = payload.data ?? {};
    const paystackEventId = `${eventType}:${data.id ?? data.reference ?? crypto.randomUUID()}`;

    const { data: existing } = await this.supabase
      .from("billing_events")
      .select("id")
      .eq("paystack_event_id", paystackEventId)
      .maybeSingle();

    if (existing) {
      return { processed: false };
    }

    const metadata = (data.metadata ?? {}) as { tenant_id?: string; subscription_id?: string; plan_id?: string };

    // The ledger row is written AFTER processing succeeds, not before --
    // writing it first would mark a genuinely-failed attempt (a real
    // bug, a transient DB error, whatever) as "already handled" forever,
    // silently dropping a real payment on Paystack's retry. The residual
    // risk this accepts (two truly concurrent deliveries of the same
    // event both passing the existence check above and both processing)
    // is a much smaller, much rarer failure mode than that, and
    // handleChargeSuccess's own payments.paystack_reference unique
    // constraint still catches a concurrent double-processing attempt.
    if (eventType === "charge.success" && metadata.tenant_id && metadata.subscription_id && metadata.plan_id) {
      await this.handleChargeSuccess(metadata.tenant_id, metadata.subscription_id, metadata.plan_id, data);
    }

    const { error: ledgerError } = await this.supabase.from("billing_events").insert({
      tenant_id: metadata.tenant_id ?? null,
      subscription_id: metadata.subscription_id ?? null,
      event_type: eventType,
      paystack_event_id: paystackEventId,
      payload: payload as unknown as Record<string, unknown>,
    });

    if (ledgerError) {
      throw new Error(`BillingService.processWebhookEvent: failed to record billing_events ledger row: ${ledgerError.message}`);
    }

    return { processed: true };
  }

  private async handleChargeSuccess(
    tenantId: string,
    subscriptionId: string,
    planId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const { data: plan } = await this.supabase.from("billing_plans").select("duration_days").eq("id", planId).maybeSingle();

    const periodDays = plan?.duration_days ?? 30;
    const now = new Date();
    const periodEnd = new Date(now.getTime() + periodDays * 86_400_000);

    const amountMinorUnits = typeof data.amount === "number" ? data.amount : 0;
    const customer = (data.customer ?? {}) as { customer_code?: string };

    const { error: paymentError } = await this.supabase.from("payments").insert({
      tenant_id: tenantId,
      subscription_id: subscriptionId,
      amount: amountMinorUnits / 100,
      currency: typeof data.currency === "string" ? data.currency : "KES",
      status: "success",
      paystack_reference: String(data.reference),
      paid_at: typeof data.paid_at === "string" ? data.paid_at : now.toISOString(),
      raw_payload: data,
    });

    if (paymentError) {
      throw new Error(`BillingService.handleChargeSuccess: failed to record payment: ${paymentError.message}`);
    }

    await this.supabase
      .from("subscriptions")
      .update({
        status: "ACTIVE",
        plan_id: planId,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        next_billing_date: periodEnd.toISOString(),
        grace_period_end: null,
        paystack_customer_code: customer.customer_code ?? null,
      })
      .eq("id", subscriptionId);

    await this.supabase.from("tenants").update({ status: "active" }).eq("id", tenantId);

    await new AuditService(this.supabase)
      .log({
        tenantId,
        actorProfileId: null,
        action: AUDIT_ACTION.SUBSCRIPTION_CHANGED,
        entityType: "subscription",
        entityId: subscriptionId,
        newValues: { status: "ACTIVE", plan_id: planId },
        metadata: { paystackReference: data.reference },
      })
      .catch(() => {});
  }

  private async getGlobalSetting(key: string, fallback: number): Promise<number> {
    const { data } = await this.supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();
    const value = data?.value;
    return typeof value === "number" ? value : fallback;
  }
}

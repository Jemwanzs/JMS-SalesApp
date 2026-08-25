import type { SupabaseClient } from "@supabase/supabase-js";

import { AuditService } from "@/services/AuditService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { initializeTransaction, verifyPaystackSignature } from "@/lib/paystack/client";
import type { AddonKey, Database, PaymentStatus, SubscriptionStatus } from "@/types/database.types";

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

export interface AddonPlanView {
  id: string;
  addonKey: AddonKey;
  code: string;
  name: string;
  price: number;
  currency: string;
  durationDays: number;
  discountPercent: number;
  isActive: boolean;
}

export interface AddonSubscriptionView {
  id: string;
  addonKey: AddonKey;
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

  /**
   * Add-on trial bootstrap (Product Enhancements #3/#7) -- unlike
   * bootstrapTrialSubscription above, this is NOT called automatically
   * at tenant creation; it's called once, on-demand, the first time a
   * tenant turns the add-on's module toggle on (features/settings/
   * actions/enable-inventory-addon.ts). Throws if no trial is currently
   * configured (inventory_addon_trial_days = 0, the migration default
   * until a Super Admin sets a real value via setAddonTrialDays) --
   * the caller falls back to a real checkout in that case, there being
   * nothing to bootstrap.
   */
  async bootstrapAddonTrial(tenantId: string, addonKey: AddonKey): Promise<void> {
    const trialDays = await this.getGlobalSetting(`${addonKey}_addon_trial_days`, 0);
    if (trialDays <= 0) {
      throw new Error(`BillingService.bootstrapAddonTrial: no trial configured for "${addonKey}"`);
    }

    const trialEnd = new Date(Date.now() + trialDays * 86_400_000).toISOString();

    const { error } = await this.supabase.from("tenant_addon_subscriptions").insert({
      tenant_id: tenantId,
      addon_key: addonKey,
      status: "TRIAL",
      trial_end: trialEnd,
    });

    if (error) {
      throw new Error(`BillingService.bootstrapAddonTrial: ${error.message}`);
    }
  }

  async listAddonPlans(addonKey: AddonKey): Promise<AddonPlanView[]> {
    const { data, error } = await this.supabase
      .from("addon_plans")
      .select("id, addon_key, code, name, price, currency, duration_days, discount_percent, is_active")
      .eq("addon_key", addonKey)
      .eq("is_active", true)
      .order("duration_days", { ascending: true });

    if (error) {
      throw new Error(`BillingService.listAddonPlans: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      addonKey: row.addon_key,
      code: row.code,
      name: row.name,
      price: Number(row.price),
      currency: row.currency,
      durationDays: row.duration_days,
      discountPercent: Number(row.discount_percent),
      isActive: row.is_active,
    }));
  }

  async getAddonSubscription(tenantId: string, addonKey: AddonKey): Promise<AddonSubscriptionView | null> {
    const { data: sub } = await this.supabase
      .from("tenant_addon_subscriptions")
      .select("id, addon_key, plan_id, status, trial_end, current_period_end, next_billing_date, grace_period_end")
      .eq("tenant_id", tenantId)
      .eq("addon_key", addonKey)
      .maybeSingle();

    if (!sub) return null;

    const plan = sub.plan_id
      ? await this.supabase.from("addon_plans").select("name, price, currency").eq("id", sub.plan_id).maybeSingle()
      : { data: null };

    return {
      id: sub.id,
      addonKey: sub.addon_key,
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
   * A tenant's most recent still-'available' Super Admin credit
   * (PlatformAdminService.grantSubscriptionCredit) -- RLS-safe (billing
   * owner or settings.manage, same as subscriptions/payments), used by
   * initializeCheckout below and to show the "you have a credit" banner
   * on the tenant's own billing page.
   *
   * `addonKey: null` (the default) matches only base-subscription credits
   * (addon_key IS NULL, what every credit granted before Phase 3 already
   * is) -- passing a real addon key scopes the lookup to that add-on's
   * own credits instead, so a base credit never accidentally covers an
   * add-on checkout or vice versa.
   */
  async getAvailableCredit(
    tenantId: string,
    addonKey: AddonKey | null = null
  ): Promise<{ id: string; amount: number; currency: string } | null> {
    let query = this.supabase
      .from("tenant_credits")
      .select("id, amount, currency")
      .eq("tenant_id", tenantId)
      .eq("status", "available");

    query = addonKey === null ? query.is("addon_key", null) : query.eq("addon_key", addonKey);

    const { data } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (!data) return null;
    return { id: data.id, amount: Number(data.amount), currency: data.currency };
  }

  /**
   * Payment status is never derived from this call's own success (the
   * Paystack-redirect branch, at least) -- starting a Standard Checkout
   * session only hands back a URL to redirect to; the webhook is what
   * actually moves the subscription to ACTIVE once Paystack confirms
   * the charge. BUT a credit that fully covers the plan's price is a
   * real, common case here (the cheapest plan is KES 100, and a support
   * credit routinely exceeds that) -- Paystack has no sensible "charge
   * KES 0" checkout, and redirecting a user to pay nothing is broken UX
   * regardless. That branch activates the subscription directly, using
   * the exact same activateSubscription() write handleChargeSuccess
   * uses for a real webhook-confirmed charge, so both paths produce
   * identical resulting state.
   */
  async initializeCheckout(input: {
    tenantId: string;
    planId: string;
    email: string;
    callbackUrl: string;
  }): Promise<{ authorizationUrl: string } | { activatedDirectly: true }> {
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

    const planPrice = Number(plan.price);
    const credit = await this.getAvailableCredit(input.tenantId);
    const applicableCredit = credit && credit.currency === plan.currency ? credit : null;

    if (applicableCredit && applicableCredit.amount >= planPrice) {
      const now = new Date().toISOString();
      const paymentId = await this.activateSubscription(input.tenantId, sub.id, input.planId, {
        amount: 0,
        currency: plan.currency,
        paystackReference: `credit_${applicableCredit.id}_${Date.now()}`,
        paidAt: now,
        customerCode: null,
        rawPayload: { creditApplied: applicableCredit.id, creditAmount: applicableCredit.amount },
      });
      await this.markCreditApplied(applicableCredit.id, paymentId);
      return { activatedDirectly: true };
    }

    const chargeAmount = applicableCredit ? planPrice - applicableCredit.amount : planPrice;
    const reference = `sub_${sub.id}_${Date.now()}`;

    const result = await initializeTransaction({
      email: input.email,
      amount: chargeAmount,
      currency: plan.currency,
      reference,
      callbackUrl: input.callbackUrl,
      metadata: {
        tenant_id: input.tenantId,
        subscription_id: sub.id,
        plan_id: input.planId,
        ...(applicableCredit ? { credit_id: applicableCredit.id } : {}),
      },
    });

    return { authorizationUrl: result.authorizationUrl };
  }

  /**
   * Add-on checkout -- structural mirror of initializeCheckout above,
   * against tenant_addon_subscriptions/addon_plans/tenant_credits
   * (addon_key-scoped) instead of the base tables. Unlike the base flow,
   * there's no guaranteed pre-existing subscription row to look up (the
   * base one is created for every tenant at signup; an add-on's only
   * gets created on-demand, via bootstrapAddonTrial when a trial is
   * available) -- so this upserts one first if the tenant is going
   * straight to a paid checkout with no trial ever bootstrapped.
   */
  async initializeAddonCheckout(input: {
    tenantId: string;
    addonKey: AddonKey;
    planId: string;
    email: string;
    callbackUrl: string;
  }): Promise<{ authorizationUrl: string } | { activatedDirectly: true }> {
    const { data: existingSub } = await this.supabase
      .from("tenant_addon_subscriptions")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .eq("addon_key", input.addonKey)
      .maybeSingle();

    let subId = existingSub?.id;
    if (!subId) {
      const { data: newSub, error: insertError } = await this.supabase
        .from("tenant_addon_subscriptions")
        .insert({ tenant_id: input.tenantId, addon_key: input.addonKey, status: "PAYMENT_DUE" })
        .select("id")
        .single();

      if (insertError || !newSub) {
        throw new Error(`BillingService.initializeAddonCheckout: ${insertError?.message}`);
      }
      subId = newSub.id;
    }

    const { data: plan, error: planError } = await this.supabase
      .from("addon_plans")
      .select("price, currency")
      .eq("id", input.planId)
      .eq("is_active", true)
      .single();

    if (planError || !plan) {
      throw new Error(`BillingService.initializeAddonCheckout: plan not found`);
    }

    const planPrice = Number(plan.price);
    const credit = await this.getAvailableCredit(input.tenantId, input.addonKey);
    const applicableCredit = credit && credit.currency === plan.currency ? credit : null;

    if (applicableCredit && applicableCredit.amount >= planPrice) {
      const now = new Date().toISOString();
      const paymentId = await this.activateAddonSubscription(input.tenantId, subId, input.addonKey, input.planId, {
        amount: 0,
        currency: plan.currency,
        paystackReference: `addoncredit_${applicableCredit.id}_${Date.now()}`,
        paidAt: now,
        customerCode: null,
        rawPayload: { creditApplied: applicableCredit.id, creditAmount: applicableCredit.amount },
      });
      await this.markAddonCreditApplied(applicableCredit.id, paymentId);
      return { activatedDirectly: true };
    }

    const chargeAmount = applicableCredit ? planPrice - applicableCredit.amount : planPrice;
    const reference = `addonsub_${subId}_${Date.now()}`;

    const result = await initializeTransaction({
      email: input.email,
      amount: chargeAmount,
      currency: plan.currency,
      reference,
      callbackUrl: input.callbackUrl,
      metadata: {
        tenant_id: input.tenantId,
        addon_subscription_id: subId,
        addon_key: input.addonKey,
        plan_id: input.planId,
        ...(applicableCredit ? { credit_id: applicableCredit.id } : {}),
      },
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

    const metadata = (data.metadata ?? {}) as {
      tenant_id?: string;
      subscription_id?: string;
      addon_subscription_id?: string;
      addon_key?: AddonKey;
      plan_id?: string;
      credit_id?: string;
    };

    // The ledger row is written AFTER processing succeeds, not before --
    // writing it first would mark a genuinely-failed attempt (a real
    // bug, a transient DB error, whatever) as "already handled" forever,
    // silently dropping a real payment on Paystack's retry. The residual
    // risk this accepts (two truly concurrent deliveries of the same
    // event both passing the existence check above and both processing)
    // is a much smaller, much rarer failure mode than that, and
    // handleChargeSuccess's own payments.paystack_reference unique
    // constraint still catches a concurrent double-processing attempt.
    //
    // Dispatches by metadata shape -- initializeCheckout's metadata
    // carries subscription_id, initializeAddonCheckout's carries
    // addon_subscription_id/addon_key instead -- one webhook route, one
    // signature check, two disjoint state machines underneath.
    if (eventType === "charge.success" && metadata.tenant_id && metadata.plan_id) {
      if (metadata.subscription_id) {
        await this.handleChargeSuccess(metadata.tenant_id, metadata.subscription_id, metadata.plan_id, data, metadata.credit_id);
      } else if (metadata.addon_subscription_id && metadata.addon_key) {
        await this.handleAddonChargeSuccess(
          metadata.tenant_id,
          metadata.addon_subscription_id,
          metadata.addon_key,
          metadata.plan_id,
          data,
          metadata.credit_id
        );
      }
    }

    const { error: ledgerError } = await this.supabase.from("billing_events").insert({
      tenant_id: metadata.tenant_id ?? null,
      subscription_id: metadata.subscription_id ?? null,
      addon_subscription_id: metadata.addon_subscription_id ?? null,
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
    data: Record<string, unknown>,
    creditId?: string
  ): Promise<void> {
    const amountMinorUnits = typeof data.amount === "number" ? data.amount : 0;
    const customer = (data.customer ?? {}) as { customer_code?: string };

    const paymentId = await this.activateSubscription(tenantId, subscriptionId, planId, {
      amount: amountMinorUnits / 100,
      currency: typeof data.currency === "string" ? data.currency : "KES",
      paystackReference: String(data.reference),
      paidAt: typeof data.paid_at === "string" ? data.paid_at : new Date().toISOString(),
      customerCode: customer.customer_code ?? null,
      rawPayload: data,
    });

    if (creditId) {
      await this.markCreditApplied(creditId, paymentId);
    }
  }

  /**
   * The one place that actually moves a subscription to ACTIVE -- shared
   * by the real webhook-confirmed path (handleChargeSuccess) and
   * initializeCheckout's "credit fully covers the plan, skip Paystack"
   * path, so both produce byte-identical resulting state. Returns the
   * new payment row's id so a credit can be marked applied against it.
   */
  private async activateSubscription(
    tenantId: string,
    subscriptionId: string,
    planId: string,
    params: {
      amount: number;
      currency: string;
      paystackReference: string;
      paidAt: string;
      customerCode: string | null;
      rawPayload: Record<string, unknown>;
    }
  ): Promise<string> {
    const { data: plan } = await this.supabase.from("billing_plans").select("duration_days").eq("id", planId).maybeSingle();

    const periodDays = plan?.duration_days ?? 30;
    const now = new Date();
    const periodEnd = new Date(now.getTime() + periodDays * 86_400_000);

    const { data: payment, error: paymentError } = await this.supabase
      .from("payments")
      .insert({
        tenant_id: tenantId,
        subscription_id: subscriptionId,
        amount: params.amount,
        currency: params.currency,
        status: "success",
        paystack_reference: params.paystackReference,
        paid_at: params.paidAt,
        raw_payload: params.rawPayload,
      })
      .select("id")
      .single();

    if (paymentError || !payment) {
      throw new Error(`BillingService.activateSubscription: failed to record payment: ${paymentError?.message}`);
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
        paystack_customer_code: params.customerCode,
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
        metadata: { paystackReference: params.paystackReference },
      })
      .catch(() => {});

    return payment.id;
  }

  private async markCreditApplied(creditId: string, paymentId: string): Promise<void> {
    const { error } = await this.supabase
      .from("tenant_credits")
      .update({ status: "applied", applied_at: new Date().toISOString(), applied_to_payment_id: paymentId })
      .eq("id", creditId)
      .eq("status", "available");

    if (error) {
      throw new Error(`BillingService.markCreditApplied: ${error.message}`);
    }
  }

  private async handleAddonChargeSuccess(
    tenantId: string,
    addonSubscriptionId: string,
    addonKey: AddonKey,
    planId: string,
    data: Record<string, unknown>,
    creditId?: string
  ): Promise<void> {
    const amountMinorUnits = typeof data.amount === "number" ? data.amount : 0;
    const customer = (data.customer ?? {}) as { customer_code?: string };

    const paymentId = await this.activateAddonSubscription(tenantId, addonSubscriptionId, addonKey, planId, {
      amount: amountMinorUnits / 100,
      currency: typeof data.currency === "string" ? data.currency : "KES",
      paystackReference: String(data.reference),
      paidAt: typeof data.paid_at === "string" ? data.paid_at : new Date().toISOString(),
      customerCode: customer.customer_code ?? null,
      rawPayload: data,
    });

    if (creditId) {
      await this.markAddonCreditApplied(creditId, paymentId);
    }
  }

  /**
   * Add-on mirror of activateSubscription -- shared by the webhook-
   * confirmed path and initializeAddonCheckout's credit-covers-it-all
   * path. Deliberately does NOT touch `tenants.status` (unlike the base
   * version) -- an add-on activating/lapsing must only affect that
   * add-on's own entitlement (lib/inventory/entitlement.ts, Phase 4),
   * never the tenant's overall access.
   */
  private async activateAddonSubscription(
    tenantId: string,
    addonSubscriptionId: string,
    addonKey: AddonKey,
    planId: string,
    params: {
      amount: number;
      currency: string;
      paystackReference: string;
      paidAt: string;
      customerCode: string | null;
      rawPayload: Record<string, unknown>;
    }
  ): Promise<string> {
    const { data: plan } = await this.supabase.from("addon_plans").select("duration_days").eq("id", planId).maybeSingle();

    const periodDays = plan?.duration_days ?? 30;
    const now = new Date();
    const periodEnd = new Date(now.getTime() + periodDays * 86_400_000);

    const { data: payment, error: paymentError } = await this.supabase
      .from("addon_payments")
      .insert({
        tenant_id: tenantId,
        addon_subscription_id: addonSubscriptionId,
        amount: params.amount,
        currency: params.currency,
        status: "success",
        paystack_reference: params.paystackReference,
        paid_at: params.paidAt,
        raw_payload: params.rawPayload,
      })
      .select("id")
      .single();

    if (paymentError || !payment) {
      throw new Error(`BillingService.activateAddonSubscription: failed to record payment: ${paymentError?.message}`);
    }

    await this.supabase
      .from("tenant_addon_subscriptions")
      .update({
        status: "ACTIVE",
        plan_id: planId,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        next_billing_date: periodEnd.toISOString(),
        grace_period_end: null,
        paystack_customer_code: params.customerCode,
      })
      .eq("id", addonSubscriptionId);

    await new AuditService(this.supabase)
      .log({
        tenantId,
        actorProfileId: null,
        action: AUDIT_ACTION.ADDON_SUBSCRIPTION_CHANGED,
        entityType: "tenant_addon_subscription",
        entityId: addonSubscriptionId,
        newValues: { status: "ACTIVE", plan_id: planId, addon_key: addonKey },
        metadata: { paystackReference: params.paystackReference },
      })
      .catch(() => {});

    return payment.id;
  }

  private async markAddonCreditApplied(creditId: string, addonPaymentId: string): Promise<void> {
    const { error } = await this.supabase
      .from("tenant_credits")
      .update({ status: "applied", applied_at: new Date().toISOString(), applied_to_addon_payment_id: addonPaymentId })
      .eq("id", creditId)
      .eq("status", "available");

    if (error) {
      throw new Error(`BillingService.markAddonCreditApplied: ${error.message}`);
    }
  }

  private async getGlobalSetting(key: string, fallback: number): Promise<number> {
    const { data } = await this.supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();
    const value = data?.value;
    return typeof value === "number" ? value : fallback;
  }
}

"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { BillingService } from "@/services/BillingService";
import { ProductService } from "@/services/ProductService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { formatTrialLength } from "@/lib/inventory/trial-copy";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface SetInventoryEnabledState {
  error?: string;
  checkoutUrl?: string;
  /** Set only on a real success (never on a checkoutUrl redirect) -- the exact copy for the success state, computed server-side so the client never has to re-derive trial-length phrasing. */
  successMessage?: string;
}

// Deliberately narrower than lib/inventory/entitlement.ts's own
// ENTITLED_STATUSES (which also tolerates PAYMENT_DUE/GRACE_PERIOD for
// *nav display*, mirroring the base subscription's grace tolerance) --
// this set answers a different question: "does re-enabling need a fresh
// payment?" TRIAL and ACTIVE both mean the tenant is already covered.
// PAYMENT_DUE/GRACE_PERIOD both mean money is owed -- including the
// artificial PAYMENT_DUE placeholder row initializeAddonCheckout itself
// creates the moment a first checkout starts, before anything is
// actually paid. Treating those as "already entitled" here would let a
// tenant back out of an unpaid checkout, toggle again, and get the
// module for free.
const ENTITLED_WITHOUT_CHECKOUT = new Set(["TRIAL", "ACTIVE"]);

/**
 * Turning the module OFF only ever flips the `tenant_settings` display
 * flag -- it never cancels or touches `tenant_addon_subscriptions`
 * billing continues; only Super Admin's deactivateAddonForTenant
 * actually cancels (a tenant hiding the module from their own nav is
 * not the same action as cancelling a paid subscription).
 *
 * Turning it ON branches three ways: (1) no subscription row yet and a
 * trial is configured -> bootstrap a trial, flip the flag, done, no
 * money involved; (2) an existing subscription that's still in an
 * entitled-ish state (TRIAL/ACTIVE/PAYMENT_DUE/GRACE_PERIOD) -> just
 * flip the flag back on, nothing to (re)pay for; (3) anything else (no
 * trial available, or a lapsed/cancelled subscription) -> a real
 * checkout is required. Only branch (3) touches money, so only that
 * branch enforces the stricter "billing owner only" rule
 * (services/billing/actions/start-checkout.ts's own established
 * boundary) on top of the page's blanket settings.manage gate -- a
 * Tenant Administrator who isn't the billing owner can still turn the
 * module on when nothing needs paying for, but can't kick off a charge
 * on someone else's behalf.
 */
export async function setInventoryEnabledAction(
  tenantId: string,
  tenantSlug: string,
  enabled: boolean,
  /** The tenant's chosen duration tier, from InventoryModuleCard's plan picker (checkout mode only -- ignored otherwise). Falls back to the shortest/first active plan if omitted or no longer valid. */
  planId?: string
): Promise<SetInventoryEnabledState> {
  await assertCan("settings.manage", { tenantId });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  const tenantService = new TenantService(supabase);

  async function saveFlag(value: boolean) {
    await tenantService.setSetting(tenantId, "inventory_enabled", value, user!.id);
    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user!.id,
        action: AUDIT_ACTION.TENANT_SETTING_CHANGED,
        entityType: "tenant_settings",
        entityId: "inventory_enabled",
        newValues: { inventory_enabled: value },
      })
      .catch(() => {});
    if (value) {
      // Every product the tenant created BEFORE this moment would
      // otherwise stay permanently invisible on the Stock page -- new
      // products default to tracks_inventory=false (a deliberate
      // per-product opt-in), and nothing else ever goes back and flips
      // it for a tenant's existing catalog. Service-role, not the
      // caller's own client: this is a system-triggered consequence of
      // enabling the module, not a user-initiated product edit, so it
      // shouldn't depend on the caller also holding products.edit on top
      // of the settings.manage this action already requires. Best-
      // effort: a failure here shouldn't block the module from turning
      // on, since the tenant can still track products individually via
      // Edit either way.
      await new ProductService(createServiceRoleClient()).enableTrackingForExistingProducts(tenantId).catch(() => {});
    }
    revalidatePath(`/t/${tenantSlug}/settings`);
    revalidatePath(`/t/${tenantSlug}/stock`);
  }

  if (!enabled) {
    try {
      await saveFlag(false);
      return {};
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Could not save this setting" };
    }
  }

  const billingService = new BillingService(createServiceRoleClient());

  try {
    const existing = await billingService.getAddonSubscription(tenantId, "inventory");

    if (existing && ENTITLED_WITHOUT_CHECKOUT.has(existing.status)) {
      await saveFlag(true);
      return { successMessage: "Inventory Management is on." };
    }

    // bootstrapAddonTrial itself decides eligibility (no row yet, OR an
    // abandoned checkout placeholder that never actually started a trial
    // or reached a real paid period) -- it throws for anything already
    // used, so attempting it unconditionally here and falling through on
    // failure is simpler and safer than duplicating that check.
    try {
      const trialDays = await billingService.bootstrapAddonTrial(tenantId, "inventory");
      await saveFlag(true);
      return { successMessage: `You now have ${formatTrialLength(trialDays)} of free Inventory access.` };
    } catch {
      // No trial configured, or already used -- fall through to checkout.
    }

    // Real money from here on -- billing owner only, mirroring
    // start-checkout.ts's own boundary.
    const { data: tenant } = await supabase.from("tenants").select("billing_owner_profile_id").eq("id", tenantId).single();
    if (!tenant || tenant.billing_owner_profile_id !== user.id) {
      return { error: "Only the billing owner can subscribe to this add-on" };
    }

    const plans = await billingService.listAddonPlans("inventory");
    const plan = (planId && plans.find((p) => p.id === planId)) || plans[0];
    if (!plan) {
      return { error: "Inventory Management is not available for subscription right now" };
    }

    const result = await billingService.initializeAddonCheckout({
      tenantId,
      addonKey: "inventory",
      planId: plan.id,
      email: user.email!,
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/t/${tenantSlug}/settings`,
    });

    if ("activatedDirectly" in result) {
      await saveFlag(true);
      return { successMessage: "Inventory Management is on." };
    }
    return { checkoutUrl: result.authorizationUrl };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not enable Inventory Management" };
  }
}

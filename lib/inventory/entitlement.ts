import "server-only";

import { BillingService } from "@/services/BillingService";
import { TenantService } from "@/services/TenantService";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { SubscriptionStatus } from "@/types/database.types";

/**
 * Real entitlement = the tenant_settings display flag AND the add-on
 * subscription being in a state that still grants access -- mirrors the
 * base subscription's own grace tolerance (has_permission() only locks
 * out at SUSPENDED, not PAYMENT_DUE/GRACE_PERIOD), so a lapsed-but-not-
 * yet-suspended add-on still shows the module.
 *
 * Product Enhancements (Overdue Read-Only Mode): SUSPENDED is entitled
 * for `"read"` but not `"write"` -- a suspended tenant can still see
 * everything they already have (stock balances, movement history,
 * reports), matching has_permission()'s own is_read_only carve-out for
 * every other module, but can't record a new movement or reconcile.
 * Previously SUSPENDED was excluded from BOTH, which cut off read
 * access to Stock entirely once suspended -- a real gap relative to
 * "the tenant can see everything they already have."
 *
 * `tenant_addon_subscriptions_select` RLS only grants the billing owner
 * or a settings.manage holder read access (same as the base
 * subscriptions table) -- an ordinary Sales User has neither, so this
 * reads via the service-role client, same reasoning as
 * SubscriptionBanner's fetch in the tenant layout. `tenant_settings`
 * itself IS readable by any tenant member (tenant_settings_select), so
 * that half uses the normal RLS-respecting client.
 *
 * This is a display/nav-gating convenience only, deliberately NOT
 * folded into the SQL has_permission() function (the highest-blast-
 * radius piece of the whole security model) -- every stock action/page
 * from Phase 6 on calls assertInventoryEnabled() itself as the real
 * server-side guard, on top of the nav already hiding the entry point.
 */
const ENTITLED_STATUSES_READ: SubscriptionStatus[] = ["TRIAL", "ACTIVE", "PAYMENT_DUE", "GRACE_PERIOD", "SUSPENDED"];
const ENTITLED_STATUSES_WRITE: SubscriptionStatus[] = ["TRIAL", "ACTIVE", "PAYMENT_DUE", "GRACE_PERIOD"];

export async function getInventoryEntitlement(
  tenantId: string,
  intent: "read" | "write" = "read"
): Promise<{ enabled: boolean; status: SubscriptionStatus | null }> {
  const supabase = await createClient();

  const [settingEnabled, addon] = await Promise.all([
    new TenantService(supabase).getSetting<boolean>(tenantId, "inventory_enabled"),
    new BillingService(createServiceRoleClient()).getAddonSubscription(tenantId, "inventory"),
  ]);

  const status = addon?.status ?? null;
  const entitledStatuses = intent === "write" ? ENTITLED_STATUSES_WRITE : ENTITLED_STATUSES_READ;
  const entitled = status !== null && entitledStatuses.includes(status);

  return { enabled: Boolean(settingEnabled) && entitled, status };
}

export async function assertInventoryEnabled(tenantId: string, intent: "read" | "write" = "read"): Promise<void> {
  const { enabled } = await getInventoryEntitlement(tenantId, intent);
  if (!enabled) {
    throw new Error("Inventory module is not enabled for this tenant");
  }
}

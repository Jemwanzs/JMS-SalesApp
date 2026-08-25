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
const ENTITLED_STATUSES: SubscriptionStatus[] = ["TRIAL", "ACTIVE", "PAYMENT_DUE", "GRACE_PERIOD"];

export async function getInventoryEntitlement(tenantId: string): Promise<{ enabled: boolean; status: SubscriptionStatus | null }> {
  const supabase = await createClient();

  const [settingEnabled, addon] = await Promise.all([
    new TenantService(supabase).getSetting<boolean>(tenantId, "inventory_enabled"),
    new BillingService(createServiceRoleClient()).getAddonSubscription(tenantId, "inventory"),
  ]);

  const status = addon?.status ?? null;
  const entitled = status !== null && ENTITLED_STATUSES.includes(status);

  return { enabled: Boolean(settingEnabled) && entitled, status };
}

export async function assertInventoryEnabled(tenantId: string): Promise<void> {
  const { enabled } = await getInventoryEntitlement(tenantId);
  if (!enabled) {
    throw new Error("Inventory module is not enabled for this tenant");
  }
}

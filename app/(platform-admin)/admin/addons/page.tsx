import type { Metadata } from "next";

import { AddonPlanForm } from "@/features/platform-admin/components/addon-plan-form";
import { AddonTrialDaysForm } from "@/features/platform-admin/components/addon-trial-days-form";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const metadata: Metadata = {
  title: "Add-ons | Platform Admin",
};

/**
 * Global commercial config for paid add-on modules (Product Enhancements
 * #3/#7) -- pricing/discount/duration/active-state per addon_plans row,
 * plus the trial-days platform_settings value. Lives here (a new global
 * page, sibling to /admin/tenants) rather than on the per-tenant Tenant
 * 360 screen, because this is genuinely global catalog config, not
 * per-tenant state -- per-tenant activation/deactivation is the part
 * that belongs on Tenant 360 (see TenantAddonPanel), and does. This is
 * also the first real admin UI for editing platform_settings/a billing
 * catalog table at all -- both have been hand-edited via migration only
 * up to this point.
 */
export default async function PlatformAdminAddonsPage() {
  const svc = new PlatformAdminService(createServiceRoleClient());
  const [plans, trialDays] = await Promise.all([svc.listAddonPlans("inventory"), svc.getAddonTrialDays("inventory")]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Add-ons</h1>
        <p className="mt-1 text-sm text-white/50">Inventory Management</p>
      </div>

      <AddonTrialDaysForm addonKey="inventory" currentDays={trialDays} />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-white/70">Plans</h2>
        <div className="space-y-2">
          {plans.length === 0 && <p className="text-sm text-white/50">No plans configured.</p>}
          {plans.map((plan) => (
            <AddonPlanForm key={plan.id} plan={plan} />
          ))}
        </div>
      </div>
    </div>
  );
}

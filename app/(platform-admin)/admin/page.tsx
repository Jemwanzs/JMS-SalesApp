import type { Metadata } from "next";

import { PlatformAdminService } from "@/services/PlatformAdminService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const metadata: Metadata = {
  title: "Platform Admin | JMS Sales App",
};

/**
 * Foundation-level dashboard (real tenant/user counts, no revenue/
 * renewal/usage KPIs yet — those need Phase 6's billing tables). Tenant
 * management actions (suspend/reactivate/access workspace), impersonation,
 * and the full KPI set are Phase 7.
 */
export default async function PlatformAdminDashboardPage() {
  const platformAdminService = new PlatformAdminService(createServiceRoleClient());
  const kpis = await platformAdminService.getDashboardKpis();

  const cards = [
    { label: "Total Tenants", value: kpis.totalTenants },
    { label: "Active Tenants", value: kpis.activeTenants },
    { label: "Suspended Tenants", value: kpis.suspendedTenants },
    { label: "Total Users", value: kpis.totalUsers },
  ];

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-white/10 bg-white/5 p-4"
          >
            <p className="text-2xl font-semibold tabular-nums">{card.value}</p>
            <p className="mt-1 text-xs text-white/60">{card.label}</p>
          </div>
        ))}
      </div>
      <p className="mt-8 max-w-[50ch] text-sm text-white/50">
        Tenant management, impersonation, billing operations, and usage
        analytics land in Phase 7.
      </p>
    </div>
  );
}

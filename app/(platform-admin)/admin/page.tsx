import Link from "next/link";
import type { Metadata } from "next";

import { PlatformAdminService } from "@/services/PlatformAdminService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const metadata: Metadata = {
  title: "Platform Admin | JMS Sales App",
};

/**
 * Foundation-level dashboard (tenant/user counts) — the full usage/
 * revenue/conversion/churn breakdown lives at /admin/analytics
 * (Phase 7c, PlatformAdminService.getUsageAnalytics()), not duplicated
 * here.
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
      <div className="grid grid-cols-2 gap-4">
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
        See{" "}
        <Link href="/admin/analytics" className="underline hover:text-white">
          Analytics
        </Link>{" "}
        for the full platform usage breakdown, or{" "}
        <Link href="/admin/tenants" className="underline hover:text-white">
          Tenants
        </Link>{" "}
        to manage a specific workspace.
      </p>
    </div>
  );
}

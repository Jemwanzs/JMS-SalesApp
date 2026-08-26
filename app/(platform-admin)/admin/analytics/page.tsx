import type { Metadata } from "next";
import { unstable_cache } from "next/cache";

import { PlatformAdminService } from "@/services/PlatformAdminService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const metadata: Metadata = {
  title: "Platform Analytics | Platform Admin",
};

// Hardening roadmap Phase 2.5 (docs/22-hardening-roadmap.md, performance
// finding #7): recomputed from scratch on every single page view before
// this. Safe to cache -- unlike the tenant-scoped Analytics page (whose
// results vary per caller's own sales.view_all/view_own grant, so a
// shared cache entry there risks serving one user's data to another;
// deliberately NOT cached here, see this doc's Phase 2.5 note), every
// platform admin sees the exact same numbers regardless of who's asking,
// so a plain time-based cache with no per-caller key needed is safe. 60s
// TTL: fresh enough for an admin dashboard, cheap enough to actually
// matter.
const getCachedUsageAnalytics = unstable_cache(
  async () => new PlatformAdminService(createServiceRoleClient()).getUsageAnalytics(),
  ["platform-admin-usage-analytics"],
  { revalidate: 60 }
);

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

/**
 * Phase 7c (docs/15-super-admin.md's "Platform usage analytics"). Read
 * -only: every number here comes from PlatformAdminService.getUsageAnalytics(),
 * which aggregates in application code from raw per-table fetches — see
 * that method's own header comment for why sales volume is never summed
 * across tenants (different tenants carry different currencies).
 */
export default async function PlatformAnalyticsPage() {
  const { summary, tenantRows } = await getCachedUsageAnalytics();

  const summaryCards = [
    { label: "Daily Active Users", value: summary.dau },
    { label: "Monthly Active Users", value: summary.mau },
    { label: "Total Tenants", value: summary.totalTenants },
    { label: "Total Sales (count)", value: summary.totalSalesCount },
    { label: "Trial → Paid Conversion", value: formatPercent(summary.trialConversionRate) },
    { label: "Churn (suspended)", value: formatPercent(summary.churnRate) },
  ];

  const sortedRows = [...tenantRows].sort((a, b) => b.salesCount - a.salesCount);

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Platform Analytics</h1>

      <div className="grid grid-cols-2 gap-3">
        {summaryCards.map((card) => (
          <div key={card.label} className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-2xl font-semibold tabular-nums">{card.value}</p>
            <p className="mt-1 text-xs text-white/60">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs text-white/50">
              <th className="p-3 font-medium">Tenant</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Sales</th>
              <th className="p-3 font-medium">Volume</th>
              <th className="p-3 font-medium">Products</th>
              <th className="p-3 font-medium">Imported Rows</th>
              <th className="p-3 font-medium">Reports</th>
              <th className="p-3 font-medium">Storage</th>
              <th className="p-3 font-medium">Last Login</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.tenantId} className="border-b border-white/5 last:border-0">
                <td className="p-3 font-medium">{row.tenantName}</td>
                <td className="p-3 text-white/70">{row.subscriptionStatus ?? "—"}</td>
                <td className="p-3 tabular-nums">{row.salesCount}</td>
                <td className="p-3 tabular-nums text-white/70">
                  {row.currency} {row.salesVolume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="p-3 tabular-nums">{row.productCount}</td>
                <td className="p-3 tabular-nums">{row.importedRowCount}</td>
                <td className="p-3 tabular-nums">{row.reportCount}</td>
                <td className="p-3 tabular-nums text-white/70">{formatBytes(row.storageBytes)}</td>
                <td className="p-3 text-white/70">{row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={9} className="p-4 text-center text-white/50">
                  No tenants yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {summary.cancelledCount > 0 && (
        <p className="mt-4 text-xs text-white/40">{summary.cancelledCount} cancelled subscription(s), tracked separately from the churn rate above.</p>
      )}
    </div>
  );
}

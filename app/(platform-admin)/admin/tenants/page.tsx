import Link from "next/link";
import type { Metadata } from "next";

import { PlatformAdminService } from "@/services/PlatformAdminService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const metadata: Metadata = {
  title: "Tenants | Platform Admin",
};

const STATUS_COLOR: Record<string, string> = {
  active: "bg-emerald-500/20 text-emerald-300",
  suspended: "bg-red-500/20 text-red-300",
  // Deliberately harder/darker than suspended's lighter red -- a
  // genuinely stronger lockout (migration 0031), should read as more
  // severe at a glance, not visually interchangeable with suspended.
  deactivated: "bg-red-900/60 text-red-200",
  cancelled: "bg-white/10 text-white/50",
};

/**
 * Phase 7a: the tenant list view (docs/15-super-admin.md's "Tenant
 * management" section — business, owner, users, plan, status, trial,
 * last payment, next payment, last activity). Detail/actions live on
 * the per-tenant page linked from each row.
 */
export default async function PlatformAdminTenantsPage() {
  const tenants = await new PlatformAdminService(createServiceRoleClient()).listTenants();

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Tenants</h1>
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-xs text-white/50">
              <th className="p-3">Business</th>
              <th className="p-3">Owner</th>
              <th className="p-3">Users</th>
              <th className="p-3">Plan</th>
              <th className="p-3">Status</th>
              <th className="p-3">Trial ends</th>
              <th className="p-3">Last payment</th>
              <th className="p-3">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-b border-white/5 hover:bg-white/5">
                <td className="p-3">
                  <Link href={`/admin/tenants/${t.id}`} className="font-medium underline">
                    {t.name}
                  </Link>
                </td>
                <td className="p-3 text-white/70">{t.ownerEmail ?? "—"}</td>
                <td className="p-3 tabular-nums">{t.userCount}</td>
                <td className="p-3 text-white/70">{t.planName ?? "—"}</td>
                <td className="p-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLOR[t.status] ?? "bg-white/10"}`}>
                    {t.status}
                    {t.subscriptionStatus ? ` · ${t.subscriptionStatus}` : ""}
                  </span>
                </td>
                <td className="p-3 text-white/70">{t.trialEnd ? new Date(t.trialEnd).toLocaleDateString() : "—"}</td>
                <td className="p-3 text-white/70">{t.lastPaymentAt ? new Date(t.lastPaymentAt).toLocaleDateString() : "—"}</td>
                <td className="p-3 text-white/70">{t.lastActivityAt ? new Date(t.lastActivityAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {tenants.length === 0 && <p className="p-6 text-center text-sm text-white/50">No tenants yet.</p>}
      </div>
    </div>
  );
}

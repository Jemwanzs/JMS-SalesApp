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
 *
 * Stacked cards, not a wide table -- this shell is mobile-first (see
 * app/(platform-admin)/admin/layout.tsx's own header comment); a
 * multi-column table with 8 fields doesn't fit a ~430px column at all,
 * so each tenant renders as one row/card with a two-line detail
 * summary instead, same "divide-y rounded-lg border" list pattern used
 * everywhere else in this app.
 */
export default async function PlatformAdminTenantsPage() {
  const tenants = await new PlatformAdminService(createServiceRoleClient()).listTenants();

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Tenants</h1>
      <div className="divide-y divide-white/5 rounded-lg border border-white/10">
        {tenants.length === 0 && <p className="p-6 text-center text-sm text-white/50">No tenants yet.</p>}
        {tenants.map((t) => (
          <Link key={t.id} href={`/admin/tenants/${t.id}`} className="block p-3 hover:bg-white/5">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-medium">{t.name}</p>
              <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${STATUS_COLOR[t.status] ?? "bg-white/10"}`}>{t.status}</span>
            </div>
            <p className="mt-1 truncate text-xs text-white/50">
              {t.ownerEmail ?? "No owner"} · {t.userCount} user{t.userCount === 1 ? "" : "s"} · {t.planName ?? "No plan"}
              {t.subscriptionStatus ? ` · ${t.subscriptionStatus}` : ""}
            </p>
            <p className="mt-1 text-xs text-white/40">
              {t.trialEnd ? `Trial ends ${new Date(t.trialEnd).toLocaleDateString()}` : null}
              {t.trialEnd && t.lastPaymentAt ? " · " : null}
              {t.lastPaymentAt ? `Last payment ${new Date(t.lastPaymentAt).toLocaleDateString()}` : null}
              {!t.trialEnd && !t.lastPaymentAt ? "No billing activity yet" : null}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}

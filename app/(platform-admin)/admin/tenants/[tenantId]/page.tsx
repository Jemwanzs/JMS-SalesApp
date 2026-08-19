import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { TenantActionsPanel } from "@/features/platform-admin/components/tenant-actions-panel";
import { BillingService } from "@/services/BillingService";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const metadata: Metadata = {
  title: "Tenant Detail | Platform Admin",
};

/**
 * Phase 7a: tenant detail + suspend/reactivate/extend-trial/adjust-
 * grace actions (docs/15-super-admin.md). "View billing" isn't a
 * separate action -- this reads BillingService directly (service-role,
 * same as everything else in this shell) for the same subscription/
 * payment data the billing owner's own screen shows.
 */
export default async function PlatformAdminTenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const svc = createServiceRoleClient();

  const [detail, payments] = await Promise.all([
    new PlatformAdminService(svc).getTenantDetail(tenantId),
    new BillingService(svc).listPayments(tenantId),
  ]);

  if (!detail) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{detail.name}</h1>
        <p className="text-sm text-white/50">/{detail.slug}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Status", value: detail.status },
          { label: "Subscription", value: detail.subscriptionStatus ?? "—" },
          { label: "Plan", value: detail.planName ?? "—" },
          { label: "Users", value: String(detail.userCount) },
          { label: "Owner", value: detail.ownerEmail ?? "—" },
          { label: "Country", value: detail.country ?? "—" },
          { label: "Trial ends", value: detail.trialEnd ? new Date(detail.trialEnd).toLocaleDateString() : "—" },
          { label: "Grace ends", value: detail.gracePeriodEnd ? new Date(detail.gracePeriodEnd).toLocaleDateString() : "—" },
          { label: "Last payment", value: detail.lastPaymentAt ? new Date(detail.lastPaymentAt).toLocaleDateString() : "—" },
          { label: "Next billing", value: detail.nextBillingDate ? new Date(detail.nextBillingDate).toLocaleDateString() : "—" },
          { label: "Last activity", value: detail.lastActivityAt ? new Date(detail.lastActivityAt).toLocaleString() : "—" },
          { label: "Created", value: new Date(detail.createdAt).toLocaleDateString() },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="text-xs text-white/50">{item.label}</p>
            <p className="mt-1 text-sm font-medium">{item.value}</p>
          </div>
        ))}
      </div>

      <TenantActionsPanel tenantId={tenantId} status={detail.status} subscriptionStatus={detail.subscriptionStatus} />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-white/70">Payment history</h2>
        <div className="divide-y divide-white/5 rounded-lg border border-white/10">
          {payments.length === 0 && <p className="p-4 text-sm text-white/50">No payments yet.</p>}
          {payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between p-3 text-sm">
              <span>
                {p.currency} {p.amount.toFixed(2)}
              </span>
              <span className="text-white/50">{new Date(p.paidAt ?? p.createdAt).toLocaleString()}</span>
              <span className={p.status === "success" ? "text-emerald-300" : "text-red-300"}>{p.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

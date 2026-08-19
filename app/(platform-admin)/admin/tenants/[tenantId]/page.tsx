import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { AccessWorkspaceDialog } from "@/features/platform-admin/components/access-workspace-dialog";
import { TenantActionsPanel } from "@/features/platform-admin/components/tenant-actions-panel";
import { BillingService } from "@/services/BillingService";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { UserService } from "@/services/UserService";
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
 *
 * Phase 7b: the Team section lists active members with an "Access
 * Workspace" entry point per user (AccessWorkspaceDialog) -- reason ->
 * platform MFA -> bounded session, per docs/15's "Impersonation" flow.
 * Reads via UserService go through the service-role client here too
 * (same reasoning as everything else on this page: the viewer is a
 * platform admin, not a real tenant member, so the RLS-respecting
 * client would see nothing).
 */
export default async function PlatformAdminTenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const svc = createServiceRoleClient();

  const [detail, payments, members] = await Promise.all([
    new PlatformAdminService(svc).getTenantDetail(tenantId),
    new BillingService(svc).listPayments(tenantId),
    new UserService(svc).listUsers(tenantId, ""),
  ]);

  if (!detail) {
    notFound();
  }

  const activeMembers = members.filter((m) => m.status === "active");

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
        <h2 className="mb-2 text-sm font-semibold text-white/70">Team — Access Workspace</h2>
        <div className="divide-y divide-white/5 rounded-lg border border-white/10">
          {activeMembers.length === 0 && <p className="p-4 text-sm text-white/50">No active users.</p>}
          {activeMembers.map((m) => (
            <div key={m.membershipId} className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{m.fullName ?? m.email}</p>
                  <p className="text-xs text-white/50">
                    {m.email} · {m.roleNames.join(", ") || "No role"}
                  </p>
                </div>
                <AccessWorkspaceDialog
                  tenantId={tenantId}
                  tenantSlug={detail.slug}
                  targetProfileId={m.profileId}
                  targetLabel={m.fullName ?? m.email}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

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

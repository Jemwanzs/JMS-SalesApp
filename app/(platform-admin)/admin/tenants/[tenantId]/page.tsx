import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { AccessWorkspaceDialog } from "@/features/platform-admin/components/access-workspace-dialog";
import { SendWishForm } from "@/features/platform-admin/components/send-wish-form";
import { TenantActionsPanel } from "@/features/platform-admin/components/tenant-actions-panel";
import { TenantAddonPanel } from "@/features/platform-admin/components/tenant-addon-panel";
import { BillingService } from "@/services/BillingService";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { UserService } from "@/services/UserService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const metadata: Metadata = {
  title: "Tenant Detail | Platform Admin",
};

/**
 * Tenant 360 (docs/15-super-admin.md): Phase 7a's original suspend/
 * reactivate/extend-trial/adjust-grace actions plus Deactivate (a
 * genuinely stronger lockout, migration 0031), Grant Credit, an on-
 * demand anniversary wish, and an Activity Log reading platform_audit_
 * logs back out (nothing did before this). "View billing" isn't a
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
 * client would see nothing). Invited/disabled members are no longer
 * silently dropped -- `members` (the full, unfiltered list) is kept
 * around for the invited-user count, only `activeMembers` is filtered
 * for the Access Workspace list (impersonation only makes sense for an
 * active member).
 */
export default async function PlatformAdminTenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const svc = createServiceRoleClient();
  const platformAdminService = new PlatformAdminService(svc);

  const [detail, payments, members, credits, auditLog, inventoryAddon] = await Promise.all([
    platformAdminService.getTenantDetail(tenantId),
    new BillingService(svc).listPayments(tenantId),
    new UserService(svc).listUsers(tenantId, ""),
    platformAdminService.listTenantCredits(tenantId),
    platformAdminService.listTenantAuditLog(tenantId),
    platformAdminService.getTenantAddon(tenantId, "inventory"),
  ]);

  if (!detail) {
    notFound();
  }

  const activeMembers = members.filter((m) => m.status === "active");
  const invitedUserCount = members.filter((m) => m.status === "invited").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{detail.name}</h1>
        <p className="text-sm text-white/50">/{detail.slug}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Status", value: detail.status },
          { label: "Subscription", value: detail.subscriptionStatus ?? "—" },
          { label: "Plan", value: detail.planName ?? "—" },
          { label: "Active users", value: String(detail.userCount) },
          { label: "Invited users", value: String(invitedUserCount) },
          { label: "Products sold", value: String(detail.productsSoldCount) },
          { label: "Owner", value: detail.ownerEmail ?? "—" },
          { label: "Country", value: detail.country ?? "—" },
          { label: "Location", value: detail.locationName ?? "—" },
          {
            label: "Anniversary",
            value: detail.anniversaryDate
              ? new Date(`${detail.anniversaryDate}T00:00:00Z`).toLocaleDateString(undefined, { month: "long", day: "numeric" })
              : "—",
          },
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

      <TenantActionsPanel
        tenantId={tenantId}
        status={detail.status}
        subscriptionStatus={detail.subscriptionStatus}
        currency={detail.currency}
      />

      <TenantAddonPanel tenantId={tenantId} addonKey="inventory" addon={inventoryAddon} currency={detail.currency} />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-white/70">Send anniversary wish</h2>
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <SendWishForm tenantId={tenantId} hasAnniversaryDate={detail.anniversaryDate !== null} />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-white/70">Credits</h2>
        <div className="divide-y divide-white/5 rounded-lg border border-white/10">
          {credits.length === 0 && <p className="p-4 text-sm text-white/50">No credits granted yet.</p>}
          {credits.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 p-3 text-sm">
              <div className="min-w-0">
                <span>
                  {c.currency} {c.amount.toFixed(2)}
                </span>
                <span className="ml-2 text-white/50">{c.reason}</span>
              </div>
              <span className={c.status === "available" ? "text-emerald-300" : "text-white/50"}>{c.status}</span>
            </div>
          ))}
        </div>
      </div>

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
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 p-3 text-sm">
              <span>
                {p.currency} {p.amount.toFixed(2)}
              </span>
              <span className="text-xs text-white/50">{new Date(p.paidAt ?? p.createdAt).toLocaleString()}</span>
              <span className={p.status === "success" ? "text-emerald-300" : "text-red-300"}>{p.status}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-white/70">Activity log</h2>
        <div className="divide-y divide-white/5 rounded-lg border border-white/10">
          {auditLog.length === 0 && <p className="p-4 text-sm text-white/50">No Super Admin actions recorded yet.</p>}
          {auditLog.map((entry) => (
            <div key={entry.id} className="p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{entry.action}</span>
                <span className="text-white/50">{new Date(entry.createdAt).toLocaleString()}</span>
              </div>
              <p className="text-xs text-white/50">{entry.adminName ?? entry.adminEmail ?? "Unknown admin"}</p>
              {entry.reason && <p className="mt-1 text-xs text-white/70">{entry.reason}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

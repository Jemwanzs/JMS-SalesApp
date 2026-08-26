import { redirect } from "next/navigation";
import { BackLink } from "@/components/shared/back-link";
import type { Metadata } from "next";

import { ApprovalsInboxList } from "@/features/sales/components/approvals-inbox-list";
import { ApprovalService } from "@/services/ApprovalService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

export const metadata: Metadata = {
  title: "Approvals | JMS Sales App",
};

/**
 * Phase 2g's reviewer-facing half: whoever holds approvals.manage sees
 * every pending request (sale voids/corrections today, more types as the
 * engine grows) and decides them here -- see docs/19-security-checklist.md
 * §5 and services/ApprovalService.ts.
 */
export default async function ApprovalsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const tenant = await getTenantBySlug(supabase, tenantSlug);

  const tenantId = tenant!.id;

  if (!(await can("approvals.manage", { tenantId }))) {
    redirect(`/t/${tenantSlug}/sales`);
  }

  const requests = await new ApprovalService(supabase).listPending(tenantId);

  return (
    <div className="flex flex-1 flex-col p-6">
      <BackLink href={`/t/${tenantSlug}/more`} label="More" />
      <h1 className="mb-4 text-xl font-semibold">Approvals</h1>
      <ApprovalsInboxList requests={requests} tenantSlug={tenantSlug} />
    </div>
  );
}

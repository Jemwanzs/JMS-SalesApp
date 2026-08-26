import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ImportDetail } from "@/features/imports/components/import-detail";
import { BackLink } from "@/components/shared/back-link";
import { ImportService } from "@/services/ImportService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

export const metadata: Metadata = {
  title: "Import Detail | JMS Sales App",
};

/**
 * docs/12's Preview / resolve-errors / Confirm steps, all on one page --
 * "2,500 Rows Uploaded / 2,431 Valid / 69 Require Attention" plus the
 * per-row reasons, the ability to fix a subset of errors on screen, and
 * the confirm action, live in ImportDetail (client component -- rows
 * get updated in place as they're resolved).
 */
export default async function ImportDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; importId: string }>;
}) {
  const { tenantSlug, importId } = await params;
  const supabase = await createClient();

  const tenant = await getTenantBySlug(supabase, tenantSlug);
  const tenantId = tenant!.id;

  if (!(await can("imports.manage", { tenantId }))) {
    redirect(`/t/${tenantSlug}/more`);
  }

  const importService = new ImportService(supabase);
  const [importSummary, rows] = await Promise.all([
    importService.getImport(importId, tenantId),
    importService.listRows(importId, tenantId),
  ]);

  if (!importSummary) {
    notFound();
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <BackLink href={`/t/${tenantSlug}/imports`} label="Imports" />
      <h1 className="text-xl font-semibold">{importSummary.fileName}</h1>
      <ImportDetail tenantId={tenantId} tenantSlug={tenantSlug} importSummary={importSummary} rows={rows} />
    </div>
  );
}

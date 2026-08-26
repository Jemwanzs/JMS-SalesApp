import type { Metadata } from "next";
import { BackLink } from "@/components/shared/back-link";
import { redirect } from "next/navigation";

import { ImportUploadForm } from "@/features/imports/components/import-upload-form";
import { ImportsList } from "@/features/imports/components/imports-list";
import { ImportService } from "@/services/ImportService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

export const metadata: Metadata = {
  title: "Imports | JMS Sales App",
};

/**
 * Phase 5: Data Migration (docs/12-imports-data-migration.md for
 * historical sales, docs/10-products.md for product catalog bulk
 * upload) -- one shared list/upload shell for both `type`s, the type
 * picker lives inside ImportUploadForm. Reads go through the RLS-
 * respecting client (imports_select/import_rows_select, migration
 * 0020, both gated on imports.manage) even though ImportService's
 * WRITES (upload/validate/resolve/confirm, all in features/imports/
 * actions/) always use service-role -- read-only listing doesn't need
 * the bulk-actor treatment writes do.
 */
export default async function ImportsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const tenant = await getTenantBySlug(supabase, tenantSlug);
  const tenantId = tenant!.id;

  if (!(await can("imports.manage", { tenantId }))) {
    redirect(`/t/${tenantSlug}/more`);
  }

  const imports = await new ImportService(supabase).listImports(tenantId);

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <BackLink href={`/t/${tenantSlug}/more`} label="More" />
      <h1 className="text-xl font-semibold">Imports</h1>
      <ImportUploadForm tenantId={tenantId} tenantSlug={tenantSlug} />
      <ImportsList imports={imports} tenantSlug={tenantSlug} />
    </div>
  );
}

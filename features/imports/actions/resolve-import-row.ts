"use server";

import { revalidatePath } from "next/cache";

import { ImportService } from "@/services/ImportService";
import { assertCan } from "@/lib/permissions/can";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface ResolveImportRowState {
  error?: string;
  valid?: boolean;
  errors?: string[];
}

export async function resolveImportRowAction(
  tenantId: string,
  tenantSlug: string,
  importId: string,
  rowId: string,
  correctedFields: Record<string, string>
): Promise<ResolveImportRowState> {
  await assertCan("imports.manage", { tenantId });

  const importService = new ImportService(createServiceRoleClient());

  try {
    const result = await importService.resolveRow(rowId, tenantId, correctedFields);
    revalidatePath(`/t/${tenantSlug}/imports/${importId}`);
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not resolve this row" };
  }
}

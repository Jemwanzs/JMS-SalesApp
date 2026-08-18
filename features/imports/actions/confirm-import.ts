"use server";

import { revalidatePath } from "next/cache";

import { ImportService } from "@/services/ImportService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface ConfirmImportState {
  error?: string;
  imported?: number;
  skipped?: number;
}

export async function confirmImportAction(
  tenantId: string,
  tenantSlug: string,
  importId: string
): Promise<ConfirmImportState> {
  await assertCan("imports.manage", { tenantId });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  const importService = new ImportService(createServiceRoleClient());

  try {
    const result = await importService.confirmImport(importId, tenantId, user.id);
    revalidatePath(`/t/${tenantSlug}/imports/${importId}`);
    revalidatePath(`/t/${tenantSlug}/imports`);
    revalidatePath(`/t/${tenantSlug}/analytics`);
    revalidatePath(`/t/${tenantSlug}/sales-history`);
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not confirm the import" };
  }
}

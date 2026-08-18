"use server";

import { revalidatePath } from "next/cache";

import { ImportService } from "@/services/ImportService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface UploadImportState {
  error?: string;
  importId?: string;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".xlsx", ".csv"];

/**
 * docs/12's Upload -> Validation steps, combined into one action -- both
 * happen synchronously in this request (see ImportService.validateImport's
 * header comment on the practical row-count ceiling that implies).
 */
export async function uploadImportAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: UploadImportState,
  formData: FormData
): Promise<UploadImportState> {
  await assertCan("imports.manage", { tenantId });

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Please choose a file to upload" };
  }
  if (!ALLOWED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
    return { error: "Only .xlsx or .csv files are supported" };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { error: "File is too large (max 10MB)" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  const importService = new ImportService(createServiceRoleClient());

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { importId } = await importService.createImport({
      tenantId,
      type: "sales_history",
      fileBuffer: buffer,
      fileName: file.name,
      uploadedBy: user.id,
    });

    await importService.validateImport(importId, tenantId);

    revalidatePath(`/t/${tenantSlug}/imports`);
    return { importId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not process the uploaded file" };
  }
}

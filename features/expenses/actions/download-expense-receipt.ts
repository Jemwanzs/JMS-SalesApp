"use server";

import { AuditService } from "@/services/AuditService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const BUCKET = "expense-receipts";
const SIGNED_URL_TTL_SECONDS = 60;

export interface DownloadExpenseReceiptState {
  error?: string;
  url?: string;
}

/**
 * Separate from viewExpenseReceiptAction (view_receipt) -- gated on its
 * own expenses.download_receipt permission so preview and save-to-device
 * stay independently grantable, per the Phase 1 permission list. Kept
 * short-lived (60s, vs. the 5-minute preview link) since a download is a
 * one-shot action, and audit-logged the way every other export/download
 * surface in this app already is (ExportCsvButton's own passcode flow,
 * DownloadService.logDownload).
 */
export async function downloadExpenseReceiptAction(tenantId: string, storagePath: string): Promise<DownloadExpenseReceiptState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("expenses.download_receipt", { tenantId });

    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS, { download: true });
    if (error || !data) {
      throw new Error(error?.message ?? "Could not generate a download link");
    }

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_RECEIPT_DOWNLOADED,
        entityType: "expenses",
        metadata: { storagePath },
      })
      .catch(() => {});

    return { url: data.signedUrl };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not download this receipt" };
  }
}

"use server";

import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "expense-receipts";
const SIGNED_URL_TTL_SECONDS = 60 * 5;

export interface ViewExpenseReceiptState {
  error?: string;
  url?: string;
}

/**
 * A short-lived (5 min) signed URL for previewing a receipt inline --
 * `createSignedUrl` itself is still subject to the bucket's SELECT RLS
 * policy (expenses.view_receipt or expenses.download_receipt), so the
 * `assertCan` here is defense in depth for a clean error message, same
 * pattern the rest of this codebase already follows, not the sole
 * enforcement boundary.
 */
export async function viewExpenseReceiptAction(tenantId: string, storagePath: string): Promise<ViewExpenseReceiptState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("expenses.view_receipt", { tenantId });

    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
      throw new Error(error?.message ?? "Could not generate a preview link");
    }
    return { url: data.signedUrl };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not open this receipt" };
  }
}

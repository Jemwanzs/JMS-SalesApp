"use server";

import { AuditService } from "@/services/AuditService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const BUCKET = "expense-receipts";
const MODEL = "claude-haiku-4-5-20251001";
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface ExtractedReceiptData {
  vendor: string | null;
  date: string | null;
  amount: number | null;
  taxAmount: number | null;
  referenceNumber: string | null;
}

export interface ExtractReceiptDataState {
  error?: string;
  data?: ExtractedReceiptData;
}

const EXTRACTION_PROMPT =
  'Read this receipt image and respond with ONLY a single JSON object, no other text, no markdown fences: ' +
  '{"vendor": string or null, "date": "YYYY-MM-DD" or null, "amount": number or null, "taxAmount": number or null, "referenceNumber": string or null}. ' +
  '"amount" is the final total paid (not a subtotal). "referenceNumber" is a receipt/invoice/transaction number if one is printed. ' +
  "Use null for any field you cannot read with confidence -- never guess.";

/**
 * Reads the receipt the user just attached (still under its client-
 * generated pendingExpenseId path -- the RLS SELECT policy on this
 * bucket keys off the tenant_id path segment alone, migration 0083, so
 * this works before the expenses row itself exists) and asks Claude's
 * vision input to read back a few fields as a SUGGESTION -- the caller
 * always reviews/edits before it's applied to the form, this never
 * writes anything itself. Gated on expenses.view_receipt (the same
 * permission viewExpenseReceiptAction already requires -- extraction is
 * fundamentally "read this receipt," same operation, same bar), AND a
 * per-tenant opt-in setting (expense_receipt_ocr_enabled, default off --
 * sending a receipt image to a third-party AI vision service is a real
 * data-sharing decision a tenant should make explicitly, not something
 * flipped on for everyone the moment a platform-wide API key exists).
 */
export async function extractReceiptDataAction(
  tenantId: string,
  storagePath: string,
  fileType: string
): Promise<ExtractReceiptDataState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("expenses.view_receipt", { tenantId });

    const ocrEnabled = await new TenantService(supabase).getSetting<boolean>(tenantId, "expense_receipt_ocr_enabled");
    if (ocrEnabled !== true) {
      return { error: "Receipt OCR is not enabled for this tenant" };
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return { error: "Receipt OCR is not configured on this deployment" };
    }

    if (!SUPPORTED_IMAGE_TYPES.has(fileType)) {
      return { error: "Receipt OCR only reads image receipts (JPEG/PNG/WebP), not PDF" };
    }

    const { data: fileBlob, error: downloadError } = await supabase.storage.from(BUCKET).download(storagePath);
    if (downloadError || !fileBlob) {
      throw new Error(downloadError?.message ?? "Could not read the receipt file");
    }

    const base64 = Buffer.from(await fileBlob.arrayBuffer()).toString("base64");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: fileType, data: base64 } },
              { type: "text", text: EXTRACTION_PROMPT },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(`Receipt OCR request failed (${response.status}): ${bodyText.slice(0, 200)}`);
    }

    const json = (await response.json()) as { content?: { type: string; text?: string }[] };
    const textBlock = json.content?.find((b) => b.type === "text" && typeof b.text === "string");
    if (!textBlock?.text) {
      throw new Error("Receipt OCR returned no readable response");
    }

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Could not parse the receipt OCR response");
    }
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const extracted: ExtractedReceiptData = {
      vendor: typeof parsed.vendor === "string" ? parsed.vendor : null,
      date: typeof parsed.date === "string" ? parsed.date : null,
      amount: typeof parsed.amount === "number" ? parsed.amount : null,
      taxAmount: typeof parsed.taxAmount === "number" ? parsed.taxAmount : null,
      referenceNumber: typeof parsed.referenceNumber === "string" ? parsed.referenceNumber : null,
    };

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_RECEIPT_OCR_EXTRACTED,
        entityType: "expenses",
        metadata: { storagePath },
      })
      .catch(() => {});

    return { data: extracted };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not extract details from this receipt" };
  }
}

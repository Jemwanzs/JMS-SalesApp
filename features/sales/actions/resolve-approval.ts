"use server";

import { revalidatePath } from "next/cache";

import { ApprovalService } from "@/services/ApprovalService";
import { createClient } from "@/lib/supabase/server";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { resolveApprovalSchema, type ResolveApprovalInput } from "@/validations/sale";
import type { ResolveApprovalResult } from "@/types/database.types";

export interface ResolveApprovalState {
  error?: string;
  fieldErrors?: Partial<Record<keyof ResolveApprovalInput, string>>;
  result?: ResolveApprovalResult;
}

export async function resolveApprovalAction(
  tenantSlug: string,
  _prevState: ResolveApprovalState,
  formData: FormData
): Promise<ResolveApprovalState> {
  const parsed = resolveApprovalSchema.safeParse({
    approvalRequestId: formData.get("approvalRequestId"),
    decision: formData.get("decision"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof ResolveApprovalInput>(parsed.error.issues),
    };
  }

  const supabase = await createClient();
  const approvalService = new ApprovalService(supabase);

  try {
    const result = await approvalService.resolve(
      parsed.data.approvalRequestId,
      parsed.data.decision,
      parsed.data.notes || null
    );
    revalidatePath(`/t/${tenantSlug}/approvals`);
    revalidatePath(`/t/${tenantSlug}/sales-history`);
    return { result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not resolve approval request" };
  }
}

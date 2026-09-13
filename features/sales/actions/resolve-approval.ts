"use server";

import { revalidatePath } from "next/cache";

import { ApprovalService } from "@/services/ApprovalService";
import { AuditService } from "@/services/AuditService";
import { AUDIT_ACTION, type AuditAction } from "@/lib/audit/actions";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { resolveApprovalSchema, type ResolveApprovalInput } from "@/validations/sale";
import type { ResolveApprovalResult } from "@/types/database.types";

export interface ResolveApprovalState {
  error?: string;
  fieldErrors?: Partial<Record<keyof ResolveApprovalInput, string>>;
  result?: ResolveApprovalResult;
}

/**
 * The generic approval-request resolver (ApprovalService, migration
 * 0006/0009/0017/0026's 5 dispatch types, plus 0085's `expense_create`)
 * is also where an approval-gated sale void/correction/reversal/
 * business-day reopen/temporary-access grant/expense actually APPLIES,
 * when a tenant requires review -- the originating action (void-sale.ts,
 * record-expense.ts, etc.) only logs its own audit event for the
 * immediate/auto-approved path. So this action maps the resolved
 * request's `type` to the matching audit action here, the one place
 * that's true for every request type regardless of where it started.
 * Two separate maps (not one ternary per type) because REJECTED means
 * "leave everything as it was" for most types but "flip the pending
 * expense's own status" for `expense_create` -- the SQL layer already
 * knows that distinction (resolve_approval_request()), this is purely
 * about which audit action to log for which outcome.
 */
const APPROVED_AUDIT_ACTION: Partial<Record<string, AuditAction>> = {
  sale_void: AUDIT_ACTION.SALE_VOIDED,
  sale_correction: AUDIT_ACTION.SALE_EDITED,
  sale_reversal: AUDIT_ACTION.SALE_EDITED,
  business_day_reopen: AUDIT_ACTION.BUSINESS_DAY_REOPENED,
  temporary_location_access: AUDIT_ACTION.TEMPORARY_ACCESS_APPROVED,
  expense_create: AUDIT_ACTION.EXPENSE_APPROVED,
};

const REJECTED_AUDIT_ACTION: Partial<Record<string, AuditAction>> = {
  temporary_location_access: AUDIT_ACTION.TEMPORARY_ACCESS_REJECTED,
  expense_create: AUDIT_ACTION.EXPENSE_REJECTED,
};

export async function resolveApprovalAction(
  tenantSlug: string,
  _prevState: ResolveApprovalState,
  formData: FormData
): Promise<ResolveApprovalState> {
  // formData.get("notes") is `null`, not `undefined`, whenever the caller
  // never appends a "notes" field -- ApprovalRowActions.decide() never
  // does (there's no notes/reason input in that UI today). A bare `null`
  // fails z.string().optional() (optional only tolerates `undefined`),
  // which made every real Approve/Reject click silently no-op: the action
  // returned `{ fieldErrors }` before ever calling the RPC, and the
  // client only checks `result.error`, so it showed a false "success"
  // toast and optimistically cleared the row while nothing was written.
  // Confirmed live via migration 0085's expense_create requests -- this
  // bug predates this phase and affects every approval type, not just
  // expenses.
  const parsed = resolveApprovalSchema.safeParse({
    approvalRequestId: formData.get("approvalRequestId"),
    decision: formData.get("decision"),
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof ResolveApprovalInput>(parsed.error.issues),
    };
  }

  const supabase = await createClient();
  const approvalService = new ApprovalService(supabase);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: request } = await supabase
    .from("approval_requests")
    .select("type, tenant_id")
    .eq("id", parsed.data.approvalRequestId)
    .maybeSingle();

  try {
    const result = await approvalService.resolve(
      parsed.data.approvalRequestId,
      parsed.data.decision,
      parsed.data.notes || null
    );

    if (request) {
      const action =
        result.status === "approved" ? APPROVED_AUDIT_ACTION[request.type] : REJECTED_AUDIT_ACTION[request.type];

      if (action) {
        await new AuditService(createServiceRoleClient())
          .log({
            tenantId: request.tenant_id,
            actorProfileId: user?.id ?? null,
            action,
            entityType: "approval_request",
            entityId: parsed.data.approvalRequestId,
            reason: parsed.data.notes || null,
          })
          .catch(() => {});
      }
    }

    revalidatePath(`/t/${tenantSlug}/approvals`);
    revalidatePath(`/t/${tenantSlug}/sales-history`);
    revalidatePath(`/t/${tenantSlug}/expenses`);
    revalidatePath(`/t/${tenantSlug}/expenses/analytics`);
    return { result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not resolve approval request" };
  }
}

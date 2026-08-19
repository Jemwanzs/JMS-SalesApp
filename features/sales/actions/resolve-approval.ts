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
 * 0006/0009/0017/0026's 5 dispatch types) is also where an approval-
 * gated sale void/correction/reversal/business-day reopen/temporary-
 * access grant actually APPLIES, when a tenant requires review -- the
 * originating action (void-sale.ts etc.) only logs its own audit event
 * for the immediate/auto-approved path. So this action maps the
 * resolved request's `type` to the matching audit action here, the one
 * place that's true for every request type regardless of where it started.
 * Fetches `type` before resolving since a REJECTED result doesn't
 * include it (ApprovalService.resolve's rejected branch returns just
 * `{ status: 'rejected' }`) -- see resolve_approval_request()'s SQL.
 */
const APPROVED_AUDIT_ACTION: Partial<Record<string, AuditAction>> = {
  sale_void: AUDIT_ACTION.SALE_VOIDED,
  sale_correction: AUDIT_ACTION.SALE_EDITED,
  sale_reversal: AUDIT_ACTION.SALE_EDITED,
  business_day_reopen: AUDIT_ACTION.BUSINESS_DAY_REOPENED,
  temporary_location_access: AUDIT_ACTION.TEMPORARY_ACCESS_APPROVED,
};

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
        result.status === "approved"
          ? APPROVED_AUDIT_ACTION[request.type]
          : request.type === "temporary_location_access"
            ? AUDIT_ACTION.TEMPORARY_ACCESS_REJECTED
            : undefined;

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
    return { result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not resolve approval request" };
  }
}

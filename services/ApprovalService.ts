import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, ResolveApprovalResult } from "@/types/database.types";

/**
 * ApprovalService — the generic approval-request lifecycle. Requests
 * themselves are always created by the domain functions that need review
 * (void_sale/correct_sale today, migration 0006) — this service only
 * lists and resolves them. See docs/19-security-checklist.md §5.
 *
 * resolve() delegates to the resolve_approval_request SECURITY DEFINER
 * function, which dispatches by `type` to apply the underlying action —
 * ApprovalService itself never knows how to apply a "sale_void" vs a
 * "sale_correction"; that dispatch logic lives once, in SQL, so it can
 * never drift from what void_sale/correct_sale themselves do.
 */
export interface PendingApprovalRequest {
  id: string;
  type: string;
  requestedBy: string;
  requestPayload: Record<string, unknown>;
  createdAt: string;
}

export class ApprovalService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listPending(tenantId: string): Promise<PendingApprovalRequest[]> {
    const { data, error } = await this.supabase
      .from("approval_requests")
      .select("id, type, requested_by, request_payload, created_at")
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`ApprovalService.listPending: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      requestedBy: row.requested_by,
      requestPayload: row.request_payload,
      createdAt: row.created_at,
    }));
  }

  async resolve(
    id: string,
    decision: "approved" | "rejected",
    notes?: string | null
  ): Promise<ResolveApprovalResult> {
    const { data, error } = await this.supabase.rpc("resolve_approval_request", {
      p_id: id,
      p_decision: decision,
      p_notes: notes ?? null,
    });

    if (error || !data) {
      throw new Error(`ApprovalService.resolve: ${error?.message}`);
    }

    return data;
  }
}

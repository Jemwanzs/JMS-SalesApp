import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * ApprovalService — the generic approval engine reused by historical sale
 * corrections, business-day reopen, temporary location access, and
 * sensitive exports (and any future consumer). Contains zero domain
 * knowledge of what "approving" any given request type actually does —
 * each consuming feature registers a handler in the dispatch map below,
 * and approve() invokes the matching handler inside the same transaction
 * that flips status -> approved. See docs/19-security-checklist.md §5 for
 * the full design and docs/03-database-schema.md for the
 * approval_requests table shape.
 *
 * When a tenant doesn't require human approval for a given type, this
 * still writes an approval_requests row immediately marked approved with
 * auto_approved: true in resolution_payload — the audit trail and
 * dispatch path are identical either way, no branching downstream.
 *
 * Not yet implemented — Phase 2g (v1, wired to sale corrections).
 */
export type ApprovalRequestType =
  | "sale_historical_correction"
  | "business_day_reopen"
  | "temporary_location_access"
  | "sensitive_export";

export interface ApprovalHandler {
  onApproved(payload: Record<string, unknown>): Promise<void>;
}

export class ApprovalService {
  private readonly handlers = new Map<ApprovalRequestType, ApprovalHandler>();

  constructor(private readonly supabase: SupabaseClient<Database>) {}

  registerHandler(type: ApprovalRequestType, handler: ApprovalHandler): void {
    this.handlers.set(type, handler);
  }

  async createRequest(_input: {
    tenantId: string;
    type: ApprovalRequestType;
    requestedBy: string;
    payload: Record<string, unknown>;
    expiresInMinutes?: number;
  }) {
    throw new Error(
      "ApprovalService.createRequest: not yet implemented (Phase 2g)"
    );
  }

  async approve(_requestId: string, _reviewerId: string, _notes?: string) {
    throw new Error("ApprovalService.approve: not yet implemented (Phase 2g)");
  }

  async reject(_requestId: string, _reviewerId: string, _notes?: string) {
    throw new Error("ApprovalService.reject: not yet implemented (Phase 2g)");
  }
}

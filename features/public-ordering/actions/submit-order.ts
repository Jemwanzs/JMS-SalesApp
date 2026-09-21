"use server";

import { PublicOrderingService, type SubmitOrderResult } from "@/services/PublicOrderingService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { submitPublicOrderSchema, type SubmitPublicOrderInput } from "@/validations/order";

export interface SubmitOrderState {
  error?: string;
  fieldErrors?: Partial<Record<keyof SubmitPublicOrderInput, string>>;
  result?: SubmitOrderResult;
}

/**
 * No getCurrentUser()/permission check -- there is no user, this is a
 * genuinely public action any visitor can call directly. Every real
 * check (tenant exists + active, both order settings on, products
 * still valid, amounts clear their minimums) lives inside
 * PublicOrderingService, which is the actual enforcement layer here
 * (mirrors features/platform-admin/actions/*.ts's own "no RLS
 * backstop, the service/action IS the check" posture for a different
 * kind of unauthenticated caller).
 */
export async function submitOrderAction(_prevState: SubmitOrderState, formData: FormData): Promise<SubmitOrderState> {
  const parsed = submitPublicOrderSchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
    customerName: formData.get("customerName"),
    mobileNumber: formData.get("mobileNumber"),
    deliveryLocation: formData.get("deliveryLocation"),
    deliveryDirections: formData.get("deliveryDirections") || undefined,
    orderNotes: formData.get("orderNotes") || undefined,
    idempotencyKey: formData.get("idempotencyKey"),
    items: formData.get("items"),
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof SubmitPublicOrderInput>(parsed.error.issues) };
  }

  try {
    const result = await new PublicOrderingService(createServiceRoleClient()).submitOrder({
      tenantSlug: parsed.data.tenantSlug,
      customerName: parsed.data.customerName,
      mobileNumber: parsed.data.mobileNumber,
      deliveryLocation: parsed.data.deliveryLocation,
      deliveryDirections: parsed.data.deliveryDirections || null,
      orderNotes: parsed.data.orderNotes || null,
      idempotencyKey: parsed.data.idempotencyKey,
      items: parsed.data.items,
    });
    return { result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not place your order. Please try again." };
  }
}

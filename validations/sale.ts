import { z } from "zod";

export const recordSaleSchema = z.object({
  productId: z.uuid(),
  actualAmount: z.coerce.number().positive("Enter an amount greater than 0"),
  quantity: z.union([z.coerce.number().positive(), z.literal("")]),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.uuid(),
});

export type RecordSaleInput = z.infer<typeof recordSaleSchema>;

// Server-action-only (safeParse against FormData, never bound to RHF/
// zodResolver), so z.coerce is safe here -- see docs/16-api-services.md's
// note on the RHF/coerce gotcha, which only applies to useForm<T>()-bound
// schemas.
export const voidSaleSchema = z.object({
  saleId: z.uuid(),
  reason: z.string().trim().min(1, "A reason is required"),
});

export type VoidSaleInput = z.infer<typeof voidSaleSchema>;

export const correctSaleSchema = z.object({
  saleId: z.uuid(),
  newAmount: z.coerce.number().nonnegative("Enter an amount of 0 or more"),
  newQuantity: z.union([z.coerce.number().positive(), z.literal("")]),
  newNotes: z.string().trim().max(500).optional(),
  reason: z.string().trim().min(1, "A reason is required"),
});

export type CorrectSaleInput = z.infer<typeof correctSaleSchema>;

export const reverseSaleSchema = z.object({
  saleId: z.uuid(),
  reason: z.string().trim().min(1, "A reason is required"),
});

export type ReverseSaleInput = z.infer<typeof reverseSaleSchema>;

export const resolveApprovalSchema = z.object({
  approvalRequestId: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  notes: z.string().trim().max(500).optional(),
});

export type ResolveApprovalInput = z.infer<typeof resolveApprovalSchema>;

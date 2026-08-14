import { z } from "zod";

export const recordSaleSchema = z.object({
  productId: z.uuid(),
  actualAmount: z.coerce.number().positive("Enter an amount greater than 0"),
  quantity: z.union([z.coerce.number().positive(), z.literal("")]),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.uuid(),
});

export type RecordSaleInput = z.infer<typeof recordSaleSchema>;

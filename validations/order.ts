import { z } from "zod";

export const createOrderProductSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(200),
  description: z.string().trim().max(1000).optional(),
  minimumOrderAmount: z.coerce.number().nonnegative("Enter a valid amount"),
  isAvailable: z.coerce.boolean().optional(),
  displayOrder: z.coerce.number().int().optional(),
});

export type CreateOrderProductInput = z.infer<typeof createOrderProductSchema>;

export const updateOrderProductSchema = createOrderProductSchema.extend({
  orderProductId: z.uuid(),
});

export type UpdateOrderProductInput = z.infer<typeof updateOrderProductSchema>;

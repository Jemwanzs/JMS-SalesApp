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

// Public storefront checkout submission (features/public-ordering) --
// no user session at all, so this is the ONLY shape-validation layer
// before PublicOrderingService's own re-validation against the live
// order_products data (prices/minimums/availability are never trusted
// from this payload, only the ids and the customer's requested
// amounts). `items` arrives as one JSON-stringified field, same
// reasoning recordSplitExpenseSchema's own transform pipe documents --
// a repeatable {orderProductId, amount} list has no clean flat-field
// FormData encoding.
const publicOrderItemSchema = z.object({
  orderProductId: z.uuid(),
  requestedAmount: z.coerce.number().positive(),
});

export const submitPublicOrderSchema = z.object({
  tenantSlug: z.string().trim().min(1),
  customerName: z.string().trim().min(1, "Enter your name").max(200),
  mobileNumber: z.string().trim().min(1, "Enter your mobile number").max(30),
  deliveryLocation: z.string().trim().min(1, "Enter a delivery location").max(500),
  deliveryDirections: z.string().trim().max(500).optional(),
  orderNotes: z.string().trim().max(500).optional(),
  idempotencyKey: z.uuid(),
  items: z
    .string()
    .transform((val, ctx) => {
      try {
        return JSON.parse(val);
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid cart data" });
        return z.NEVER;
      }
    })
    .pipe(z.array(publicOrderItemSchema).min(1, "Your cart is empty")),
});

export type SubmitPublicOrderInput = z.infer<typeof submitPublicOrderSchema>;

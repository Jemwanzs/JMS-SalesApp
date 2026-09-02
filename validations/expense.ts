import { z } from "zod";

export const expenseItemTypeSchema = z.enum(["recurring", "one_time"]);

export const createExpenseItemSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(200),
  expenseType: expenseItemTypeSchema,
  // A guide only -- never enforced against the actual amount recorded
  // later, see the migration's own header comment.
  estimatedAmount: z.union([z.coerce.number().nonnegative(), z.literal("")]).optional(),
});

export type CreateExpenseItemInput = z.infer<typeof createExpenseItemSchema>;

export const updateExpenseItemSchema = createExpenseItemSchema.extend({
  expenseItemId: z.uuid(),
});

export type UpdateExpenseItemInput = z.infer<typeof updateExpenseItemSchema>;

// Server-action-only (safeParse against FormData, never bound to RHF/
// zodResolver) -- see validations/sale.ts's own note on why z.coerce is
// safe here.
export const recordExpenseSchema = z.object({
  expenseItemId: z.uuid(),
  actualAmount: z.coerce.number().positive("Enter an amount greater than 0"),
  // "The date may be changed to a past date only. Do not allow
  // future-dated expenses" -- the max-date bound is re-checked against
  // the server's own clock in ExpenseService, not just here (a client
  // could send any string, however this schema was authored).
  expenseDate: z.iso.date(),
  notes: z.string().trim().max(500).optional(),
});

export type RecordExpenseInput = z.infer<typeof recordExpenseSchema>;

export const editExpenseSchema = z.object({
  expenseId: z.uuid(),
  actualAmount: z.coerce.number().positive("Enter an amount greater than 0"),
  expenseDate: z.iso.date(),
  notes: z.string().trim().max(500).optional(),
});

export type EditExpenseInput = z.infer<typeof editExpenseSchema>;

export const voidExpenseSchema = z.object({
  expenseId: z.uuid(),
  reason: z.string().trim().min(1, "A reason is required"),
});

export type VoidExpenseInput = z.infer<typeof voidExpenseSchema>;

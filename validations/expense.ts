import { z } from "zod";

export const expenseItemTypeSchema = z.enum(["recurring", "one_time"]);

export const createExpenseItemSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(200),
  expenseType: expenseItemTypeSchema,
  // A guide only -- never enforced against the actual amount recorded
  // later, see the migration's own header comment.
  estimatedAmount: z.union([z.coerce.number().nonnegative(), z.literal("")]).optional(),
  // "" from an empty <select> means "no category" -- normalized to null
  // in the action before reaching the service, same convention
  // estimatedAmount's own "" -> null handling already uses.
  categoryId: z.union([z.uuid(), z.literal("")]).optional(),
});

export type CreateExpenseItemInput = z.infer<typeof createExpenseItemSchema>;

export const updateExpenseItemSchema = createExpenseItemSchema.extend({
  expenseItemId: z.uuid(),
});

export type UpdateExpenseItemInput = z.infer<typeof updateExpenseItemSchema>;

export const createExpenseCategorySchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(200),
  receiptRequired: z.coerce.boolean().optional(),
  requiresApproval: z.coerce.boolean().optional(),
});

export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>;

export const updateExpenseCategorySchema = createExpenseCategorySchema.extend({
  categoryId: z.uuid(),
});

export type UpdateExpenseCategoryInput = z.infer<typeof updateExpenseCategorySchema>;

export const createExpensePaymentMethodSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(200),
  isDefault: z.coerce.boolean().optional(),
});

export type CreateExpensePaymentMethodInput = z.infer<typeof createExpensePaymentMethodSchema>;

export const updateExpensePaymentMethodSchema = createExpensePaymentMethodSchema.extend({
  paymentMethodId: z.uuid(),
});

export type UpdateExpensePaymentMethodInput = z.infer<typeof updateExpensePaymentMethodSchema>;

// Server-action-only (safeParse against FormData, never bound to RHF/
// zodResolver) -- see validations/sale.ts's own note on why z.coerce is
// safe here.
export const recordExpenseSchema = z.object({
  // Client-generated (see ExpenseService.RecordExpenseInput's own
  // comment) -- optional here only so a hand-built FormData missing it
  // still gets a clear validation error rather than an opaque DB one.
  id: z.uuid().optional(),
  expenseItemId: z.uuid(),
  categoryId: z.uuid("Select a category"),
  paymentMethodId: z.uuid("Select a payment method"),
  actualAmount: z.coerce.number().positive("Enter an amount greater than 0"),
  // "The date may be changed to a past date only. Do not allow
  // future-dated expenses" -- the max-date bound is re-checked against
  // the server's own clock in ExpenseService, not just here (a client
  // could send any string, however this schema was authored).
  expenseDate: z.iso.date(),
  vendor: z.string().trim().max(200).optional(),
  referenceNumber: z.string().trim().max(100).optional(),
  taxAmount: z.union([z.coerce.number().nonnegative(), z.literal("")]).optional(),
  reimbursable: z.coerce.boolean().optional(),
  receiptStoragePath: z.string().optional(),
  receiptFileType: z.string().optional(),
  notes: z.string().trim().max(500).optional(),
});

export type RecordExpenseInput = z.infer<typeof recordExpenseSchema>;

export const correctExpenseSchema = z.object({
  expenseId: z.uuid(),
  reason: z.string().trim().min(1, "A reason is required"),
  expenseItemId: z.uuid(),
  categoryId: z.uuid("Select a category"),
  paymentMethodId: z.uuid("Select a payment method"),
  actualAmount: z.coerce.number().positive("Enter an amount greater than 0"),
  expenseDate: z.iso.date(),
  vendor: z.string().trim().max(200).optional(),
  referenceNumber: z.string().trim().max(100).optional(),
  taxAmount: z.union([z.coerce.number().nonnegative(), z.literal("")]).optional(),
  reimbursable: z.coerce.boolean().optional(),
  receiptStoragePath: z.string().optional(),
  receiptFileType: z.string().optional(),
  notes: z.string().trim().max(500).optional(),
});

export type CorrectExpenseInput = z.infer<typeof correctExpenseSchema>;

export const voidExpenseSchema = z.object({
  expenseId: z.uuid(),
  reason: z.string().trim().min(1, "A reason is required"),
});

export type VoidExpenseInput = z.infer<typeof voidExpenseSchema>;

export const createExpenseBudgetSchema = z.object({
  locationId: z.uuid("Select a branch"),
  categoryId: z.uuid("Select a category"),
  monthlyAmount: z.coerce.number().nonnegative("Enter a valid amount"),
});

export type CreateExpenseBudgetInput = z.infer<typeof createExpenseBudgetSchema>;

export const updateExpenseBudgetSchema = createExpenseBudgetSchema.extend({
  budgetId: z.uuid(),
});

export type UpdateExpenseBudgetInput = z.infer<typeof updateExpenseBudgetSchema>;

export const markExpenseReimbursedSchema = z.object({
  expenseId: z.uuid(),
  reference: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

export type MarkExpenseReimbursedInput = z.infer<typeof markExpenseReimbursedSchema>;

export const createExpenseRecurringTemplateSchema = z.object({
  locationId: z.uuid("Select a branch"),
  expenseItemId: z.uuid("Select an expense item"),
  categoryId: z.uuid("Select a category"),
  paymentMethodId: z.uuid("Select a payment method"),
  amount: z.coerce.number().positive("Enter an amount greater than 0"),
  dayOfMonth: z.coerce.number().int().min(1, "Pick a day 1-31").max(31, "Pick a day 1-31"),
  vendor: z.string().trim().max(200).optional(),
  referenceNumber: z.string().trim().max(100).optional(),
  taxAmount: z.union([z.coerce.number().nonnegative(), z.literal("")]).optional(),
  reimbursable: z.coerce.boolean().optional(),
  notes: z.string().trim().max(500).optional(),
});

export type CreateExpenseRecurringTemplateInput = z.infer<typeof createExpenseRecurringTemplateSchema>;

export const updateExpenseRecurringTemplateSchema = createExpenseRecurringTemplateSchema.extend({
  templateId: z.uuid(),
});

export type UpdateExpenseRecurringTemplateInput = z.infer<typeof updateExpenseRecurringTemplateSchema>;

const expenseSplitLineSchema = z.object({
  categoryId: z.uuid(),
  amount: z.coerce.number().positive(),
});

// `splits` arrives as one JSON-stringified FormData field (a repeatable
// list of {categoryId, amount} rows has no clean flat-field encoding the
// way every other expense form here uses) -- parsed and shape-validated
// in one pass rather than trusting the client's JSON.
export const recordSplitExpenseSchema = z.object({
  expenseItemId: z.uuid("Select an expense item"),
  paymentMethodId: z.uuid("Select a payment method"),
  expenseDate: z.iso.date(),
  splits: z
    .string()
    .transform((val, ctx) => {
      try {
        return JSON.parse(val);
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid split data" });
        return z.NEVER;
      }
    })
    .pipe(z.array(expenseSplitLineSchema).min(2, "Add at least 2 categories to split this expense")),
  vendor: z.string().trim().max(200).optional(),
  referenceNumber: z.string().trim().max(100).optional(),
  reimbursable: z.coerce.boolean().optional(),
  receiptStoragePath: z.string().optional(),
  receiptFileType: z.string().optional(),
  notes: z.string().trim().max(500).optional(),
});

export type RecordSplitExpenseInput = z.infer<typeof recordSplitExpenseSchema>;

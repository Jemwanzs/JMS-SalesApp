import { z } from "zod";

// Server-action-only (safeParse against FormData, never RHF-bound). `until`
// arrives as the client's `Date.toISOString()` output -- validated as a
// parseable date rather than a strict ISO regex to avoid fighting zod's
// ISO-format edge cases for a value we already control the shape of.
export const reopenBusinessDaySchema = z.object({
  businessDayId: z.uuid(),
  reason: z.string().trim().min(1, "A reason is required"),
  until: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date"),
});

export type ReopenBusinessDayInput = z.infer<typeof reopenBusinessDaySchema>;

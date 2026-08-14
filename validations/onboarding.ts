import { z } from "zod";

/**
 * Onboarding wizard schemas (spec S10 Steps 1-2; Steps 3-6 are
 * intentionally not real forms yet -- see
 * features/onboarding/components/coming-later-step.tsx). Shared by the
 * RHF resolvers and the server actions that parse FormData.
 */

export const CURRENCIES = ["KES", "NGN", "GHS", "UGX", "TZS", "ZAR", "USD", "EUR", "GBP"] as const;
export const TIMEZONES = [
  "Africa/Nairobi",
  "Africa/Lagos",
  "Africa/Accra",
  "Africa/Kampala",
  "Africa/Dar_es_Salaam",
  "Africa/Johannesburg",
  "Europe/London",
  "America/New_York",
  "UTC",
] as const;

// Deliberately no .transform() here -- react-hook-form's useForm<T> and
// zodResolver need the schema's input and output types to match (the
// form holds pre-submit string values like ""); converting "" to null
// happens at the point of use (save-business-details.ts) instead.
export const businessDetailsSchema = z.object({
  businessType: z.string().trim().min(1, "Business type is required"),
  website: z.union([z.url("Enter a valid URL"), z.literal("")]),
  anniversaryDate: z.union([z.iso.date(), z.literal("")]),
  currency: z.enum(CURRENCIES),
  timezone: z.enum(TIMEZONES),
});

export type BusinessDetailsInput = z.infer<typeof businessDetailsSchema>;

export const dayHoursSchema = z.object({
  dayOfWeek: z.number().min(0).max(6),
  openTime: z.string(),
  closeTime: z.string(),
  closedAllDay: z.boolean(),
});

export const locationHoursSchema = z.object({
  locationName: z.string().trim().min(1, "Location name is required"),
  address: z.string().trim().min(1, "Address is required"),
  hours: z.array(dayHoursSchema).length(7),
});

export type LocationHoursInput = z.infer<typeof locationHoursSchema>;

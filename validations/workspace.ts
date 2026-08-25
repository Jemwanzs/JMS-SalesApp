import { z } from "zod";

import { CURRENCIES, TIMEZONES } from "@/validations/onboarding";

/**
 * Deliberately its own schema rather than reusing onboarding's
 * businessDetailsSchema, even though most fields overlap: onboarding
 * Step 1 never asks for the business name (sign-up already captured
 * it), while this post-onboarding Workspace edit treats it as a real
 * editable field -- sharing one schema would force one of the two
 * flows to carry a field it doesn't want.
 */
export const businessProfileSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required"),
  businessType: z.string().trim().min(1, "Business type is required"),
  website: z.union([z.url("Enter a valid URL"), z.literal("")]),
  anniversaryDate: z.union([z.iso.date(), z.literal("")]),
  currency: z.enum(CURRENCIES),
  timezone: z.enum(TIMEZONES),
});

export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;

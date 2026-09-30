"use server";

import { PublicOrderingService, type CustomerOrderHistory } from "@/services/PublicOrderingService";
import { checkRateLimit, getClientIp, orderLookupRateLimit } from "@/lib/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { lookupCustomerOrdersSchema, type LookupCustomerOrdersInput } from "@/validations/order";

export interface LookupCustomerOrdersState {
  error?: string;
  fieldErrors?: Partial<Record<keyof LookupCustomerOrdersInput, string>>;
  result?: CustomerOrderHistory;
}

/**
 * No getCurrentUser()/permission check -- same genuinely-public posture
 * as submitOrderAction. Rate-limited by IP (confirmed with the user:
 * no second-factor verification on the lookup itself) since, unlike an
 * unguessable tracking token, a mobile number is realistically
 * guessable -- this is the actual abuse mitigation, not a database
 * check.
 */
export async function lookupCustomerOrdersAction(
  _prevState: LookupCustomerOrdersState,
  formData: FormData
): Promise<LookupCustomerOrdersState> {
  const parsed = lookupCustomerOrdersSchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
    mobileNumber: formData.get("mobileNumber"),
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof LookupCustomerOrdersInput>(parsed.error.issues) };
  }

  const ip = await getClientIp();
  const { allowed } = await checkRateLimit(orderLookupRateLimit, ip);
  if (!allowed) {
    return { error: "Too many attempts. Please try again in a while." };
  }

  try {
    const result = await new PublicOrderingService(createServiceRoleClient()).getCustomerOrderHistory(
      parsed.data.tenantSlug,
      parsed.data.mobileNumber
    );
    if (!result) {
      return { error: "This ordering page is not available" };
    }
    return { result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not look up your orders. Please try again." };
  }
}

import { cache } from "react";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

/**
 * supabase.auth.getUser() validates the session against Supabase Auth
 * over the network on every call -- not a local JWT decode. Several
 * layouts/pages in the same request tree each called it independently
 * ([tenantSlug]/layout.tsx, then again in sales/analytics/billing/
 * users/security/sales-history/more page.tsx), paying that round trip
 * once per navigation for no reason, since the answer can't change
 * mid-request. Wrapped in React's cache() the same way
 * lib/permissions/can.ts already dedupes get_my_permissions() -- every
 * caller in one request reuses the same in-flight/resolved call.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

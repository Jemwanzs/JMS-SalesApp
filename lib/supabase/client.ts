import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/types/database.types";

/**
 * Browser Supabase client — anon key, respects RLS.
 *
 * Safe to import in Client Components. Never import this (or any anon-key
 * client) as a substitute for the service-role client — it can only ever
 * see what RLS allows the signed-in user to see.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

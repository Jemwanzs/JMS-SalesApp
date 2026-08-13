import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/types/database.types";

/**
 * Request-bound server Supabase client — anon key + the current user's
 * JWT (from cookies), respects RLS.
 *
 * Use this from Server Components, Server Actions, and Route Handlers that
 * act on behalf of a signed-in user. This is the ONLY client that server
 * actions/services should use for ordinary tenant-scoped reads/writes —
 * see docs/02-system-architecture.md's "layering rule".
 *
 * Server Components can only read cookies, not write them — the try/catch
 * below absorbs the write attempt there, since a middleware refreshing the
 * session covers that path instead (see docs/17-devops-deployment.md for
 * the middleware note once Phase 1c lands it).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — no-op, middleware refreshes
            // the session cookie instead.
          }
        },
      },
    }
  );
}

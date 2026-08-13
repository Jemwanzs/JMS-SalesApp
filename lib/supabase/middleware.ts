import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session on every matched request. Required
 * because Server Components can't write cookies themselves (see
 * lib/supabase/server.ts) — this is the one place in the app that can, so
 * an expiring access token gets silently refreshed before it ever causes
 * a signed-in user to appear logged out.
 *
 * Standard @supabase/ssr Next.js middleware pattern — do not "simplify"
 * the response-recreation inside setAll(); skipping it is a well-known
 * source of session bugs (stale/lost cookies) with this library.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Touching auth.getUser() is what actually triggers the refresh.
  await supabase.auth.getUser();

  return supabaseResponse;
}

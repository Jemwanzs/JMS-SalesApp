import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { AuditService } from "@/services/AuditService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const MAX_SESSION_AGE_MS = 12 * 60 * 60 * 1000;
const SID_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

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
 *
 * Smart Auto-Login & 12-Hour Session: this is also where the hard
 * session-age cap lives, for the same "the one place that already runs
 * on every request and can write cookies" reason. The cap is anchored to
 * `sessions.created_at` (written once, at actual sign-in, by
 * SecurityService.createSession -- see sign-in.ts), NOT the JWT's own
 * `iat`/`exp`, which move every time the access token silently refreshes
 * above. Using the refreshable token's own timestamps would let the
 * "12 hours" window slide forward forever just from continued use,
 * exactly what was explicitly ruled out. `sessions.created_at` never
 * changes after the row is created, so "now − created_at > 12h" is a
 * true, non-extending cap from the original authentication, checked
 * against this server's own clock (Date.now()) against a server-written
 * Postgres timestamp -- never the visitor's device clock.
 *
 * A session with no `sid` cookie, or a `sid` with no matching row (a
 * session that predates this feature, or a best-effort cookie write that
 * silently failed at sign-in), is deliberately left alone rather than
 * forced out -- there's no basis to enforce a limit that can't be
 * measured, matching this codebase's established "self-heal, don't
 * hard-fail everyone the moment a migration ships" posture (see e.g.
 * active_branch_sessions).
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const sid = request.cookies.get("sid")?.value;

    if (sid) {
      const serviceRole = createServiceRoleClient();
      const { data: session } = await serviceRole
        .from("sessions")
        .select("created_at, revoked_at, tenant_id")
        .eq("id", sid)
        .maybeSingle();

      if (session && !session.revoked_at) {
        const ageMs = Date.now() - new Date(session.created_at).getTime();

        if (ageMs > MAX_SESSION_AGE_MS) {
          await supabase.auth.signOut();

          const reason = "12-hour session limit reached";
          await Promise.all([
            serviceRole
              .from("sessions")
              .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
              .eq("id", sid),
            new AuditService(serviceRole)
              .log({
                tenantId: session.tenant_id,
                actorProfileId: user.id,
                action: AUDIT_ACTION.SESSION_REVOKED,
                entityType: "session",
                entityId: sid,
                reason,
              })
              .catch(() => {}),
          ]).catch(() => {});

          const redirectResponse = NextResponse.redirect(new URL("/login?sessionExpired=1", request.url));
          supabaseResponse.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
          redirectResponse.cookies.set("sid", "", { ...SID_COOKIE_OPTIONS, maxAge: 0 });
          return redirectResponse;
        }
      }
    }
  }

  return supabaseResponse;
}

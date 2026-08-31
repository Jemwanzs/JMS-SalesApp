import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Hardening roadmap Phase 1 (docs/22-hardening-roadmap.md): webhooks
    // and cron routes authenticate themselves (Paystack's HMAC signature,
    // CRON_SECRET's bearer token) and never read the Supabase session --
    // paying for a session-refresh round trip before those handlers even
    // run adds real latency right where Paystack's retry window is least
    // forgiving. Every other route still needs it -- /auth/callback IS
    // the session flow (a client page, not under app/api/ -- see its
    // own header comment for why), and api/t/[tenantSlug]/imports/
    // template relies on the RLS-respecting cookie session to check
    // tenant membership.
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

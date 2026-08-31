import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

/**
 * Exchanges an email-link param for a real session. Both
 * AuthService.signUp's emailRedirectTo and AuthService.requestPasswordReset
 * /UserService.inviteUser's redirectTo point here with a `next` query param
 * telling this route where to send the user afterward.
 *
 * Two params this route can receive, and they are NOT interchangeable:
 *
 * - `token_hash` + `type` -- Supabase's hash-based verification
 *   (verifyOtp). Self-contained: the hash alone proves the link is
 *   genuine, no other state required. This is what actually works for a
 *   real recovery/invite/confirmation email, since the person clicking
 *   it is very often not in the same browser (or even the same device)
 *   that requested it -- checking email on a phone after requesting a
 *   reset on desktop, or opening the link from a mail app's own
 *   in-app browser.
 * - `code` -- PKCE code exchange (exchangeCodeForSession). This
 *   REQUIRES the `code_verifier` this same client generated and stored
 *   in a cookie when the flow was first initiated. That guarantee only
 *   holds for a flow that starts and finishes in one continuous browser
 *   session (e.g. an OAuth redirect) -- for an emailed link opened
 *   later, in whatever browser the user's mail client happens to use,
 *   the verifier cookie is frequently just not there, and the exchange
 *   fails with no real explanation shown to the user. Kept here only as
 *   a fallback for any flow that might still send a bare `code`.
 *
 * Which one actually arrives depends on the exact URL configured in each
 * Supabase Auth email template (Authentication -> Email Templates in the
 * dashboard) -- token_hash requires the template's link to be built as
 * `{{ .SiteURL }}/api/auth/callback?token_hash={{ .TokenHash }}&type=<type>&next=<path>`
 * rather than the default `{{ .ConfirmationURL }}`, which is PKCE-code-based.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/login";

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
}

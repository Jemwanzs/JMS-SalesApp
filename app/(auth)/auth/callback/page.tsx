"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

/**
 * Landing point for every email-link flow: password reset
 * (AuthService.requestPasswordReset), signup confirmation
 * (AuthService.signUp), and user invites (UserService.inviteUser/
 * resendInvite) all point their redirectTo/emailRedirectTo here.
 *
 * MUST be a client page, not a server Route Handler -- this project's
 * Supabase Auth is configured for the implicit flow, not PKCE: Supabase's
 * own hosted /auth/v1/verify endpoint verifies the link server-side
 * (works from any browser/device, no problem there) and then redirects
 * here with the session tokens already issued, sitting directly in the
 * URL FRAGMENT (#access_token=...&refresh_token=...), not a query param.
 * A fragment is never sent in the actual HTTP request to the server --
 * only client-side JS can ever see it. A server Route Handler at this
 * exact path was tried first and always fell through to its own
 * "nothing matched" branch, which is why every one of these links
 * silently landed back on /login instead of the intended next page.
 *
 * Confirmed empirically (not assumed) by generating a real invite link
 * via supabase.auth.admin.generateLink and following its actual
 * redirect chain -- both invite and recovery links produced
 * #access_token=... on the redirect, no `code` or `token_hash` param
 * anywhere.
 *
 * Suspense boundary is required by Next.js for any page using
 * useSearchParams() -- without it, `next build`'s static export step
 * fails outright ("useSearchParams() should be wrapped in a suspense
 * boundary"), it's not optional here.
 */
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<p className="text-center text-sm text-muted-foreground">Verifying your link...</p>}>
      <AuthCallbackInner />
    </Suspense>
  );
}

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const next = searchParams.get("next") ?? "/login";
    const rawHash = window.location.hash;
    const hashParams = new URLSearchParams(rawHash.startsWith("#") ? rawHash.slice(1) : rawHash);

    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    const hashError = hashParams.get("error_description") ?? hashParams.get("error");

    if (hashError || !accessToken || !refreshToken) {
      setFailed(true);
      router.replace("/login?error=auth-callback-failed");
      return;
    }

    const supabase = createClient();
    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
      if (error) {
        setFailed(true);
        router.replace("/login?error=auth-callback-failed");
        return;
      }
      router.replace(next);
    });
  }, [router, searchParams]);

  return (
    <p className="text-center text-sm text-muted-foreground">
      {failed ? "That link is invalid or has expired." : "Verifying your link..."}
    </p>
  );
}

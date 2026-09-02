import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/features/auth/components/login-form";
import { AuthPromoBanner } from "@/components/shared/auth-promo-banner";
import { UserGuideLink } from "@/components/shared/user-guide-link";
import { DemoVideoLink } from "@/components/shared/demo-video-link";
import { getCurrentUser } from "@/lib/supabase/current-user";

export const metadata: Metadata = {
  title: "Log in | JMS Sales App",
};

/**
 * Smart Auto-Login: the actual root cause of "users keep being asked to
 * log in" wasn't a session/cookie bug (see lib/supabase/middleware.ts's
 * own header comment for the full session-lifetime design) -- it was
 * this page never checking whether the visitor already has one. A
 * signed-in user landing here (bookmark, back button, a stale tab, a
 * marketing-page "Login" link) used to see the form again regardless of
 * their session's real validity. Reuses app/page.tsx's already-correct
 * post-login routing (active tenant / onboarding / no-tenant) via a
 * plain redirect rather than duplicating any of that logic here.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sessionExpired?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) {
    redirect("/");
  }

  const { sessionExpired } = await searchParams;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Welcome back</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Log in to record today&apos;s sales.
      </p>
      {sessionExpired && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Your session expired after 12 hours. Please sign in again.
        </p>
      )}
      <LoginForm />
      <UserGuideLink />
      <DemoVideoLink />
      <AuthPromoBanner />
    </div>
  );
}

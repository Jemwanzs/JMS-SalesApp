import { AuthBackground } from "@/components/shared/auth-background";
import { Logo } from "@/components/shared/logo";

/**
 * Mobile-first shell for auth screens: the max ~430px centred column
 * required by docs/07-ui-ux-screen-map.md, pulled forward for these
 * specific pages rather than waiting on the full Phase 1f app shell
 * (PWA manifest, bottom nav, etc., which doesn't apply pre-login anyway).
 *
 * Redesigned per an explicit request to "beautify the login page": a
 * warm-cream, rounded-corner card (bg-background -- already this app's
 * "warm cream" token, see globals.css) floats centered over a scattered,
 * blurred photo-wall background (AuthBackground) instead of the previous
 * plain full-height column. Applied at this shared layout level, not
 * just /login, so signup/reset-password/verify-email/invite-confirm all
 * stay visually consistent with it rather than looking like a
 * regression the moment someone navigates one step further.
 *
 * Both the background and the card live INSIDE the same max-w-[430px]
 * column (not the full outer width) -- a follow-up fix so the photo
 * wall stays confined to the app's own mobile-app-fit sizing on a wide
 * desktop viewport instead of spreading across the whole browser width.
 *
 * Page surface is bg-card (white -- already this app's "elevated
 * surface" token) while the card itself stays bg-background (warm
 * cream) -- a deliberate inversion of how those two tokens are used
 * everywhere else in the app (cream page + white card), per an explicit
 * request to keep the login CARD cream while whitening the page around
 * it.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full justify-center bg-card">
      <div className="relative flex w-full max-w-[430px] flex-col items-center justify-center overflow-hidden px-4 py-10">
        <AuthBackground />
        <div className="relative z-10 w-full rounded-3xl border border-border/60 bg-background p-6 shadow-xl shadow-black/10 sm:p-8">
          <Logo className="mb-8" />
          {children}
        </div>
      </div>
    </div>
  );
}

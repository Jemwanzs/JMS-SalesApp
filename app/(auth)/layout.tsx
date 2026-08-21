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
 * Page surface is a hand-picked very-light warm cream (#fdfbf6, lighter
 * than the card's own #faf3e6 -- see globals.css's --background) while
 * the card stays the app's normal --background cream -- not pure white
 * (tried first, then explicitly asked to be warmed/lightened instead)
 * and not the same shade as the card, so the card still reads as a
 * distinct, slightly deeper surface floating above the page.
 *
 * `contain-layout` on the inner shell -- same trick app/(tenant)/t/
 * [tenantSlug]/layout.tsx and the platform-admin shell already use --
 * makes this div a containing block for `position: fixed` descendants,
 * so AuthPromoBanner (login/signup only, rendered inside `children`)
 * stays confined to this ~430px mobile-app-fit column even on a wide
 * desktop viewport, instead of anchoring to the full browser window the
 * way `fixed` normally would.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full justify-center bg-[#fdfbf6] dark:bg-[#2d271d]">
      <div className="relative flex w-full max-w-[430px] flex-col items-center justify-center overflow-hidden contain-layout px-4 py-10">
        <AuthBackground />
        <div className="relative z-10 w-full rounded-3xl border border-border/60 bg-background p-6 shadow-xl shadow-black/10 sm:p-8">
          <Logo className="mb-8" />
          {children}
        </div>
      </div>
    </div>
  );
}

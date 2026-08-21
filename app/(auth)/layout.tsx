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
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background px-4 py-10">
      <AuthBackground />
      <div className="relative z-10 w-full max-w-[430px] rounded-3xl border border-border/60 bg-background p-6 shadow-xl shadow-black/10 sm:p-8">
        <Logo className="mb-8" />
        {children}
      </div>
    </div>
  );
}

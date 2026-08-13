import { Logo } from "@/components/shared/logo";

/**
 * Mobile-first shell for auth screens: the max ~430-480px centred column
 * required by docs/07-ui-ux-screen-map.md, pulled forward for these
 * specific pages rather than waiting on the full Phase 1f app shell
 * (PWA manifest, bottom nav, etc., which doesn't apply pre-login anyway).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full justify-center bg-muted/30">
      <div className="flex w-full max-w-[430px] flex-col px-6 py-12">
        <Logo className="mb-10" />
        <div className="flex flex-1 flex-col justify-center">{children}</div>
      </div>
    </div>
  );
}

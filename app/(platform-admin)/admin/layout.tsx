import { redirect } from "next/navigation";

import { PlatformAdminBottomNav } from "@/features/platform-admin/components/platform-admin-bottom-nav";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { resolvePreferredFont } from "@/lib/branding/preferred-font";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Entirely separate shell from the tenant app (spec S92: "completely
 * separate from ordinary tenant navigation") — no shared Logo/nav
 * component, no TenantProvider, reached only by typing /admin directly
 * (never linked from tenant navigation). Mobile-first, matching the
 * rest of this project's own established pattern (app/(tenant)/t/
 * [tenantSlug]/layout.tsx's `max-w-[430px]` centered column + bottom
 * tab bar): this shell used to be a full-bleed desktop dashboard with a
 * horizontal nav row that simply didn't fit a phone screen. Same
 * `contain-layout` trick as the tenant shell so a portaled Dialog/Sheet
 * stays within this narrow column instead of centering on the whole
 * browser window on a wide viewport.
 *
 * The is_platform_admin check MUST run through the service-role client
 * — platform_admins has no RLS policy granting the authenticated role
 * any access at all (see supabase/migrations/0004), so checking via the
 * ordinary RLS-respecting client would always resolve to "not an admin"
 * regardless of who's asking.
 */
export default async function PlatformAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const platformAdminService = new PlatformAdminService(createServiceRoleClient());
  const isAdmin = await platformAdminService.isPlatformAdmin(user.id);

  if (!isAdmin) {
    redirect("/");
  }

  // User & Tenant Branding Personalization: same per-user font
  // preference the tenant shell applies (lib/branding/preferred-font.ts),
  // set on this shell's own wrapper rather than <html> -- see
  // app/layout.tsx's own header comment for why.
  const preferredFont = await resolvePreferredFont(supabase, user.id);

  return (
    <div className="flex min-h-screen w-full justify-center bg-[#05070D]">
      <div
        id="platform-admin-shell"
        data-font={preferredFont}
        className="relative flex w-full max-w-[430px] flex-col contain-layout bg-[#0B1220] text-[#F2F1EC]"
      >
        <header className="border-b border-white/10 px-4 py-4">
          <p className="text-sm font-semibold tracking-wide">PLATFORM ADMIN</p>
          <p className="mt-0.5 truncate text-xs text-white/50">{user.email}</p>
        </header>
        <main className="flex-1 p-4">{children}</main>
        <PlatformAdminBottomNav />
      </div>
    </div>
  );
}

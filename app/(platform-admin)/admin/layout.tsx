import Link from "next/link";
import { redirect } from "next/navigation";

import { PlatformAdminService } from "@/services/PlatformAdminService";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Entirely separate shell from the tenant app (spec S92: "completely
 * separate from ordinary tenant navigation") — no shared Logo/nav
 * component, no TenantProvider, reached only by typing /admin directly
 * (never linked from tenant navigation).
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

  return (
    <div className="min-h-screen bg-[#0B1220] text-[#F2F1EC]">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold tracking-wide">
            PLATFORM ADMIN
          </span>
          <nav className="flex items-center gap-4 text-sm text-white/70">
            <Link href="/admin" className="hover:text-white">
              Dashboard
            </Link>
            <Link href="/admin/tenants" className="hover:text-white">
              Tenants
            </Link>
          </nav>
        </div>
        <span className="text-xs text-white/50">{user.email}</span>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}

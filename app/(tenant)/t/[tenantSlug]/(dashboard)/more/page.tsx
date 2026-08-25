import Link from "next/link";
import {
  Building2,
  ChevronRight,
  CreditCard,
  Lock,
  LogOut,
  Package,
  Settings,
  ShieldCheck,
  Upload,
  UserCog,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { signOutAction } from "@/features/auth/actions/sign-out";
import { Button } from "@/components/ui/button";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getCurrentUser } from "@/lib/supabase/current-user";

/**
 * The "More" menu (spec S12), regrouped in the UX-efficiency pass:
 * everyday items (Products, Security -- Sales History moved to the
 * bottom nav) in their own section, admin/rare items (Approvals, Roles,
 * Users, Imports, Billing, Settings) in a second, visually distinct
 * section, so an admin's 9+ item list doesn't read as one undifferentiated
 * stack. Notifications (13-notifications.md) is still shown disabled
 * rather than omitted, so the full menu shape stays visible. Security
 * (4c) is a real, always-present link -- every signed-in user manages
 * their own sessions/login history there regardless of permissions (RLS
 * gates the tenant-wide activity section within the page itself, not
 * this menu entry). Notifications and Help were removed from this list
 * (they only ever rendered as disabled "Coming soon" rows) per explicit
 * request -- re-add once those features actually ship. Approvals (2g),
 * Roles (4a), Users (4b), Imports (Phase 5), Billing (Phase 6), and
 * Settings (Phase 7d's anniversary wish-mode toggle, its first real
 * setting) are all appended conditionally instead, only for users who
 * actually hold approvals.manage/roles.manage/(users.create or users.
 * edit)/imports.manage/(billing owner or settings.manage)/settings.manage
 * -- unlike Security they aren't meant to be visible-but-disabled for
 * everyone, since most users will never have anything to review or
 * manage there.
 */
const EVERYDAY_ITEMS: { label: string; icon: LucideIcon; href?: string }[] = [
  { label: "Products", icon: Package, href: "products" },
  { label: "Security", icon: Lock, href: "security" },
];

export default async function MorePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const [user, { data: tenant }] = await Promise.all([
    getCurrentUser(),
    supabase.from("tenants").select("id, billing_owner_profile_id").eq("slug", tenantSlug).single(),
  ]);

  const [canManageApprovals, canManageRoles, canCreateUsers, canEditUsers, canManageImports, canManageSettings, isPlatformAdmin] =
    tenant && user
      ? await Promise.all([
          can("approvals.manage", { tenantId: tenant.id }),
          can("roles.manage", { tenantId: tenant.id }),
          can("users.create", { tenantId: tenant.id }),
          can("users.edit", { tenantId: tenant.id }),
          can("imports.manage", { tenantId: tenant.id }),
          can("settings.manage", { tenantId: tenant.id }),
          new PlatformAdminService(createServiceRoleClient()).isPlatformAdmin(user.id),
        ])
      : [false, false, false, false, false, false, false];

  const isBillingOwner = tenant?.billing_owner_profile_id === user?.id;

  const adminItems: { label: string; icon: LucideIcon; href?: string; absoluteHref?: string }[] = [
    ...(canManageApprovals ? [{ label: "Approvals", icon: ShieldCheck, href: "approvals" }] : []),
    ...(canManageRoles ? [{ label: "Roles", icon: UserCog, href: "roles" }] : []),
    ...(canCreateUsers || canEditUsers ? [{ label: "Users", icon: Users, href: "users" }] : []),
    // Platform-admin-only shortcut into the separate /admin shell -- not
    // a tenant-scoped route, so it carries absoluteHref instead of href.
    ...(isPlatformAdmin ? [{ label: "Tenants", icon: Building2, absoluteHref: "/admin/tenants" }] : []),
    ...(canManageImports ? [{ label: "Imports", icon: Upload, href: "imports" }] : []),
    ...(isBillingOwner || canManageSettings ? [{ label: "Billing", icon: CreditCard, href: "billing" }] : []),
    ...(canManageSettings ? [{ label: "Settings", icon: Settings, href: "settings" }] : []),
  ];

  return (
    <div className="flex flex-1 flex-col p-6">
      <h1 className="mb-4 text-xl font-semibold">More</h1>

      <MenuSection items={EVERYDAY_ITEMS} tenantSlug={tenantSlug} />

      {adminItems.length > 0 && (
        <>
          <p className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Team &amp; business
          </p>
          <MenuSection items={adminItems} tenantSlug={tenantSlug} />
        </>
      )}

      <form action={signOutAction} className="mt-6">
        <Button type="submit" variant="outline" className="w-full">
          <LogOut className="h-4 w-4" />
          Log out
        </Button>
      </form>
    </div>
  );
}

function MenuSection({
  items,
  tenantSlug,
}: {
  items: { label: string; icon: LucideIcon; href?: string; absoluteHref?: string }[];
  tenantSlug: string;
}) {
  return (
    <div className="divide-y rounded-lg border">
      {items.map(({ label, icon: Icon, href, absoluteHref }) =>
        href || absoluteHref ? (
          <Link
            key={label}
            href={absoluteHref ?? `/t/${tenantSlug}/${href}`}
            className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted"
          >
            <span className="flex items-center gap-3">
              <Icon className="h-4 w-4" />
              {label}
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        ) : (
          <div
            key={label}
            className="flex items-center justify-between px-4 py-3 text-sm text-muted-foreground"
          >
            <span className="flex items-center gap-3">
              <Icon className="h-4 w-4" />
              {label}
            </span>
            <span className="flex items-center gap-1 text-xs">
              Coming soon
              <ChevronRight className="h-4 w-4" />
            </span>
          </div>
        )
      )}
    </div>
  );
}

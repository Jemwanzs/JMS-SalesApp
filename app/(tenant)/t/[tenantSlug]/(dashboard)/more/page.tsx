import Link from "next/link";
import {
  Bell,
  ChevronRight,
  CircleHelp,
  History,
  LogOut,
  Package,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { signOutAction } from "@/features/auth/actions/sign-out";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

/**
 * The "More" menu (spec S12): Products, Sales History, Notifications,
 * Settings, Help, Logout. Products (2a) and Sales History (2i, void/
 * correct actions from 2e) now link to real pages; the rest are real
 * destinations from later phases (Notifications: 13-notifications.md,
 * Settings: Phase 4) shown as disabled rather than omitted so the full
 * menu shape stays visible. Approvals (2g), Roles (4a), and Users (4b)
 * are all appended conditionally, only for users who actually hold
 * approvals.manage/roles.manage/(users.create or users.edit) -- unlike
 * the others they aren't meant to be visible-but-disabled for everyone,
 * since most users will never have anything to review or manage there.
 */
const MENU_ITEMS: { label: string; icon: LucideIcon; href?: string }[] = [
  { label: "Products", icon: Package, href: "products" },
  { label: "Sales History", icon: History, href: "sales-history" },
  { label: "Notifications", icon: Bell },
  { label: "Settings", icon: Settings },
  { label: "Help", icon: CircleHelp },
];

export default async function MorePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .single();

  const [canManageApprovals, canManageRoles, canCreateUsers, canEditUsers] = tenant
    ? await Promise.all([
        can("approvals.manage", { tenantId: tenant.id }),
        can("roles.manage", { tenantId: tenant.id }),
        can("users.create", { tenantId: tenant.id }),
        can("users.edit", { tenantId: tenant.id }),
      ])
    : [false, false, false, false];

  const menuItems = [
    ...MENU_ITEMS,
    ...(canManageApprovals ? [{ label: "Approvals", icon: ShieldCheck, href: "approvals" }] : []),
    ...(canManageRoles ? [{ label: "Roles", icon: UserCog, href: "roles" }] : []),
    ...(canCreateUsers || canEditUsers ? [{ label: "Users", icon: Users, href: "users" }] : []),
  ];

  return (
    <div className="flex flex-1 flex-col p-6">
      <h1 className="mb-4 text-xl font-semibold">More</h1>

      <div className="divide-y rounded-lg border">
        {menuItems.map(({ label, icon: Icon, href }) =>
          href ? (
            <Link
              key={label}
              href={`/t/${tenantSlug}/${href}`}
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

      <form action={signOutAction} className="mt-6">
        <Button type="submit" variant="outline" className="w-full">
          <LogOut className="h-4 w-4" />
          Log out
        </Button>
      </form>
    </div>
  );
}

import Link from "next/link";
import {
  Building2,
  ChevronRight,
  CreditCard,
  HelpCircle,
  Lock,
  LogOut,
  Package,
  Receipt,
  Settings,
  ShieldCheck,
  Sliders,
  Sparkles,
  Store,
  Upload,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { signOutAction } from "@/features/auth/actions/sign-out";
import { Button } from "@/components/ui/button";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { TenantService } from "@/services/TenantService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

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
 * this menu entry). Notifications and Help were originally removed from
 * this list (they only ever rendered as disabled "Coming soon" rows) per
 * explicit request -- re-add once those features actually ship; Help
 * came back as "Help & Support" (hardening roadmap Phase 3.1) once
 * /support was a real page, not a stub. Approvals (2g),
 * Roles (4a), Users (4b), Imports (Phase 5), Billing (Phase 6), and
 * Settings (Phase 7d's anniversary wish-mode toggle, its first real
 * setting) are all appended conditionally instead, only for users who
 * actually hold approvals.manage/roles.manage/(users.create or users.
 * edit)/imports.manage/(billing owner or settings.manage)/settings.manage
 * -- unlike Security they aren't meant to be visible-but-disabled for
 * everyone, since most users will never have anything to review or
 * manage there.
 */
export default async function MorePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const [user, tenant] = await Promise.all([getCurrentUser(), getTenantBySlug(supabase, tenantSlug)]);

  const [
    canManageApprovals,
    canManageRoles,
    canCreateUsers,
    canEditUsers,
    canManageImports,
    canManageSettings,
    isPlatformAdmin,
    canConfigureExpenseItems,
    canViewExpenses,
    expensesEnabled,
  ] =
    tenant && user
      ? await Promise.all([
          can("approvals.manage", { tenantId: tenant.id }),
          can("roles.manage", { tenantId: tenant.id }),
          can("users.create", { tenantId: tenant.id }),
          can("users.edit", { tenantId: tenant.id }),
          can("imports.manage", { tenantId: tenant.id }),
          can("settings.manage", { tenantId: tenant.id }),
          new PlatformAdminService(createServiceRoleClient()).isPlatformAdmin(user.id),
          can("expenses.configure_items", { tenantId: tenant.id }),
          can("expenses.view", { tenantId: tenant.id }),
          new TenantService(supabase).getSetting<boolean>(tenant.id, "expenses_enabled"),
        ])
      : [false, false, false, false, false, false, false, false, false, false];

  const isBillingOwner = tenant?.billing_owner_profile_id === user?.id;

  // Help & Support's ?from= lets /support's own Back button return here
  // exactly, rather than guessing from browser history -- see
  // components/shared/back-link-smart.tsx's own header comment.
  const everydayItems: { label: string; icon: LucideIcon; href?: string; absoluteHref?: string }[] = [
    { label: "Products", icon: Package, href: "products" },
    { label: "My Preferences", icon: Sliders, href: "preferences" },
    { label: "Security", icon: Lock, href: "security" },
    { label: "Help & Support", icon: HelpCircle, absoluteHref: `/support?from=/t/${tenantSlug}/more` },
    { label: "Restart Product Tour", icon: Sparkles, absoluteHref: `/t/${tenantSlug}/sales?restartTour=1` },
  ];

  const adminItems: { label: string; icon: LucideIcon; href?: string; absoluteHref?: string }[] = [
    // First in the section (the user's explicit "surface it at the
    // top" ask) -- business name/type/website/anniversary/currency/
    // timezone/working hours set once at sign-up/onboarding, with no
    // edit surface anywhere until now.
    ...(canManageSettings ? [{ label: "Workspace", icon: Store, href: "workspace" }] : []),
    ...(canManageApprovals ? [{ label: "Approvals", icon: ShieldCheck, href: "approvals" }] : []),
    ...(canManageRoles ? [{ label: "Roles", icon: UserCog, href: "roles" }] : []),
    ...(canCreateUsers || canEditUsers ? [{ label: "Users", icon: Users, href: "users" }] : []),
    // Platform-admin-only shortcut into the separate /admin shell -- not
    // a tenant-scoped route, so it carries absoluteHref instead of href.
    ...(isPlatformAdmin ? [{ label: "Tenants", icon: Building2, absoluteHref: "/admin/tenants" }] : []),
    ...(canManageImports ? [{ label: "Imports", icon: Upload, href: "imports" }] : []),
    ...(isBillingOwner || canManageSettings ? [{ label: "Billing", icon: CreditCard, href: "billing" }] : []),
    // Daily Expenses: both gated on the feature being on AND the
    // relevant permission -- hidden, not shown-disabled, same
    // convention every other conditional row here already follows.
    // Placed immediately before Settings per spec.
    ...(expensesEnabled && canConfigureExpenseItems ? [{ label: "Expense Items", icon: Receipt, href: "expense-items" }] : []),
    ...(expensesEnabled && canViewExpenses ? [{ label: "Expenses", icon: Wallet, href: "expenses" }] : []),
    ...(canManageSettings ? [{ label: "Settings", icon: Settings, href: "settings" }] : []),
  ];

  return (
    <div className="flex flex-1 flex-col p-6">
      <h1 className="mb-4 text-xl font-semibold">More</h1>

      <MenuSection items={everydayItems} tenantSlug={tenantSlug} />

      {adminItems.length > 0 && (
        <>
          <p className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Team &amp; business
          </p>
          <MenuSection items={adminItems} tenantSlug={tenantSlug} />
        </>
      )}

      <form action={signOutAction} className="mt-6 flex justify-center">
        <Button
          type="submit"
          className="rounded-full bg-red-800 px-6 text-white hover:bg-red-900"
        >
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

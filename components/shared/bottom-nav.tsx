"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { BarChart3, Boxes, FileText, History, Menu, ShoppingCart } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTenant, usePermission } from "@/hooks/tenant-context";

interface NavItem {
  href: string;
  /** Key into the "Nav" message namespace (messages/{locale}.json) -- not the display label itself, see NavLink's useTranslations call. */
  labelKey: "sales" | "history" | "analytics" | "reports" | "stock" | "more";
  icon: LucideIcon;
  /** null = always visible (e.g. More/settings/logout). */
  permission: string | null;
  /**
   * Product Enhancements #3: gates a nav item on a TenantContext
   * setting flag too, in addition to `permission` -- both must be true.
   * `undefined`/absent = no setting gate, same as every existing item
   * today. `historyEnabled`/`analyticsEnabled`/`reportsEnabled` are the
   * "Reporting Tabs" settings (Settings page) a tenant admin can toggle
   * to hide a core tab, default ON.
   */
  requiresSetting?: "inventoryEnabled" | "historyEnabled" | "analyticsEnabled" | "reportsEnabled";
}

/**
 * Persistent bottom nav (spec S12, widened in the UX-efficiency pass):
 * Sales, Sales History, Analytics, Reports, More. "Users only see
 * modules permitted by their assigned access rights" is enforced here
 * at the nav level, not just at the destination page -- defense in
 * depth alongside the RLS/route-level checks each page will apply. A
 * Sales User (no reports.view grant by default, see docs/06-roles-
 * permissions.md) correctly never sees a Reports tab.
 *
 * Sales History was promoted from a More-menu-only entry to a full tab:
 * it was the everyday destination with the worst click-depth in the
 * original audit (2 taps to reach, no "today" shortcut once there) --
 * `permission: null` matches its prior unconditional visibility in
 * more/page.tsx's own MENU_ITEMS (RLS's sales.view_own/view_all split
 * already governs what rows the page itself can show, same as before).
 */
const NAV_ITEMS: NavItem[] = [
  { href: "sales", labelKey: "sales", icon: ShoppingCart, permission: "sales.view_own" },
  { href: "sales-history", labelKey: "history", icon: History, permission: null, requiresSetting: "historyEnabled" },
  { href: "analytics", labelKey: "analytics", icon: BarChart3, permission: "analytics.view_own", requiresSetting: "analyticsEnabled" },
  { href: "reports", labelKey: "reports", icon: FileText, permission: "reports.view", requiresSetting: "reportsEnabled" },
  { href: "stock", labelKey: "stock", icon: Boxes, permission: "inventory.view", requiresSetting: "inventoryEnabled" },
  { href: "more", labelKey: "more", icon: Menu, permission: null },
];

export function BottomNav() {
  const { tenantSlug } = useTenant();
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 z-10 flex border-t bg-background">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.href}
          tenantSlug={tenantSlug}
          pathname={pathname}
          item={item}
        />
      ))}
    </nav>
  );
}

function NavLink({
  tenantSlug,
  pathname,
  item,
}: {
  tenantSlug: string;
  pathname: string;
  item: NavItem;
}) {
  // Hook must be called unconditionally regardless of whether this item
  // requires a permission -- "__always__" never matches a real
  // permission key, so hasPermission is simply unused when permission
  // is null.
  const hasPermission = usePermission(item.permission ?? "__always__");
  const { inventoryEnabled, historyEnabled, analyticsEnabled, reportsEnabled } = useTenant();
  const t = useTranslations("Nav");
  const permitted = item.permission === null || hasPermission;
  const settingFlags = { inventoryEnabled, historyEnabled, analyticsEnabled, reportsEnabled };
  const settingSatisfied = item.requiresSetting == null || settingFlags[item.requiresSetting];
  const visible = permitted && settingSatisfied;

  if (!visible) {
    return null;
  }

  const href = `/t/${tenantSlug}/${item.href}`;
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const Icon = item.icon;

  return (
    <Link
      href={href}
      data-tour-id={`tour-nav-${item.href}`}
      className={cn(
        "flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors",
        active ? "text-primary" : "text-muted-foreground"
      )}
    >
      <Icon className="h-5 w-5" />
      {t(item.labelKey)}
    </Link>
  );
}

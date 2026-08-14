"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FileText, Menu, ShoppingCart } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTenant, usePermission } from "@/hooks/tenant-context";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** null = always visible (e.g. More/settings/logout). */
  permission: string | null;
}

/**
 * Persistent bottom nav (spec S12): Sales, Analytics, Reports, More.
 * "Users only see modules permitted by their assigned access rights" is
 * enforced here at the nav level, not just at the destination page --
 * defense in depth alongside the RLS/route-level checks each page will
 * apply. A Sales User (no reports.view grant by default, see
 * docs/06-roles-permissions.md) correctly never sees a Reports tab.
 */
const NAV_ITEMS: NavItem[] = [
  { href: "sales", label: "Sales", icon: ShoppingCart, permission: "sales.view_own" },
  { href: "analytics", label: "Analytics", icon: BarChart3, permission: "analytics.view_own" },
  { href: "reports", label: "Reports", icon: FileText, permission: "reports.view" },
  { href: "more", label: "More", icon: Menu, permission: null },
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
  const visible = item.permission === null || hasPermission;

  if (!visible) {
    return null;
  }

  const href = `/t/${tenantSlug}/${item.href}`;
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const Icon = item.icon;

  return (
    <Link
      href={href}
      className={cn(
        "flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors",
        active ? "text-primary" : "text-muted-foreground"
      )}
    >
      <Icon className="h-5 w-5" />
      {item.label}
    </Link>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Building2, Cake, LayoutDashboard, Package } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/tenants", label: "Tenants", icon: Building2 },
  { href: "/admin/addons", label: "Add-ons", icon: Package },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/anniversaries", label: "Anniversaries", icon: Cake },
];

/**
 * Mobile-first bottom tab bar for the platform-admin shell, matching
 * components/shared/bottom-nav.tsx's exact structural pattern (sticky
 * bottom, flex-1 icon+label items) so this shell reads as "part of the
 * same app" instead of a completely separate desktop dashboard dropped
 * into a phone-width viewport. Replaces the previous single-row
 * horizontal nav (Dashboard | Tenants | Analytics | Anniversaries +
 * email), which didn't fit small screens at all -- no permission gating
 * needed here, unlike the tenant app's version, since every route under
 * /admin is equally available to any platform admin (the layout's own
 * isPlatformAdmin check already gates the whole shell).
 */
export function PlatformAdminBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 z-10 flex border-t border-white/10 bg-[#0B1220]">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors ${
              active ? "text-white" : "text-white/50"
            }`}
          >
            <Icon className="h-5 w-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

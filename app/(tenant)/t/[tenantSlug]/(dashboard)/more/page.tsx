import Link from "next/link";
import {
  Bell,
  ChevronRight,
  CircleHelp,
  History,
  LogOut,
  Package,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { signOutAction } from "@/features/auth/actions/sign-out";
import { Button } from "@/components/ui/button";

/**
 * The "More" menu (spec S12): Products, Sales History, Notifications,
 * Settings, Help, Logout. Products now links to the real page (Phase
 * 2a); the rest are real destinations from later phases (Sales
 * History: 2i, Notifications: 13-notifications.md, Settings: Phase 4)
 * shown as disabled rather than omitted so the full menu shape stays
 * visible.
 */
const MENU_ITEMS: { label: string; icon: LucideIcon; href?: string }[] = [
  { label: "Products", icon: Package, href: "products" },
  { label: "Sales History", icon: History },
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

  return (
    <div className="flex flex-1 flex-col p-6">
      <h1 className="mb-4 text-xl font-semibold">More</h1>

      <div className="divide-y rounded-lg border">
        {MENU_ITEMS.map(({ label, icon: Icon, href }) =>
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

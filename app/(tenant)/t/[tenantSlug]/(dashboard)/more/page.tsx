import {
  Bell,
  ChevronRight,
  CircleHelp,
  History,
  LogOut,
  Package,
  Settings,
} from "lucide-react";

import { signOutAction } from "@/features/auth/actions/sign-out";
import { Button } from "@/components/ui/button";

/**
 * The "More" menu (spec S12): Products, Sales History, Notifications,
 * Settings, Help, Logout. Only Logout is wired up -- the rest are real
 * destinations from later phases (Products: 2a, Sales History: 2i,
 * Notifications: 13-notifications.md, Settings: throughout Phase 4).
 * Shown as disabled rather than omitted so the full menu shape is
 * visible now.
 */
const MENU_ITEMS = [
  { label: "Products", icon: Package },
  { label: "Sales History", icon: History },
  { label: "Notifications", icon: Bell },
  { label: "Settings", icon: Settings },
  { label: "Help", icon: CircleHelp },
];

export default function MorePage() {
  return (
    <div className="flex flex-1 flex-col p-6">
      <h1 className="mb-4 text-xl font-semibold">More</h1>

      <div className="divide-y rounded-lg border">
        {MENU_ITEMS.map(({ label, icon: Icon }) => (
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
        ))}
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

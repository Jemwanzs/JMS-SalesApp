import { BottomNav } from "@/components/shared/bottom-nav";

/**
 * Applies to every route under (dashboard) -- sales/analytics/reports/
 * more now, and products/settings/users/security/billing once those
 * land in later phases (docs/02-system-architecture.md) -- so the
 * bottom nav stays persistent across the whole authenticated app per
 * spec S119's mobile page structure, not just the four tab
 * destinations themselves.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col">{children}</div>
      <BottomNav />
    </div>
  );
}

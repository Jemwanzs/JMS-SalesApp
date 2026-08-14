/**
 * Placeholder -- daily/weekly/monthly reports and the rule-based
 * insights engine are Phase 3 (docs/11-analytics-reports.md). Only
 * reachable by roles with reports.view (see BottomNav's permission
 * gating) -- a Sales User correctly never sees this tab.
 */
export default function ReportsPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
      <p className="text-lg font-medium">Reports</p>
      <p className="mt-2 max-w-[30ch] text-sm text-muted-foreground">
        Daily, weekly, and custom-period reports land in Phase 3.
      </p>
    </div>
  );
}

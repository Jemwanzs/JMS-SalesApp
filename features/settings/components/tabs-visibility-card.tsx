"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setAnalyticsEnabledAction } from "@/features/settings/actions/set-analytics-enabled";
import { setHistoryEnabledAction } from "@/features/settings/actions/set-history-enabled";
import { setReportsEnabledAction } from "@/features/settings/actions/set-reports-enabled";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Three independent visibility toggles for the persistent bottom-nav
 * tabs (Sales History / Analytics / Reports), same shape as
 * ProductRankingCard's multi-switch-in-one-card pattern -- these are
 * core, always-existed tabs, not a new module, so this only controls
 * whether a tenant admin has chosen to show or hide them, on top of
 * (not instead of) each tab's own existing permission gate
 * (sales.view_own-implied for History, analytics.view_own, reports.view
 * -- components/shared/bottom-nav.tsx). Default ON for all three,
 * matching every tenant's existing behavior before this setting
 * existed -- turning one off hides it from the nav AND redirects a
 * direct visit to the page itself back to Sales (defense in depth, same
 * pattern as Inventory/Daily Expenses's own module gates).
 */
export function TabsVisibilityCard({
  tenantId,
  tenantSlug,
  initialHistoryEnabled,
  initialAnalyticsEnabled,
  initialReportsEnabled,
}: {
  tenantId: string;
  tenantSlug: string;
  initialHistoryEnabled: boolean;
  initialAnalyticsEnabled: boolean;
  initialReportsEnabled: boolean;
}) {
  const [historyEnabled, setHistoryEnabled] = useState(initialHistoryEnabled);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(initialAnalyticsEnabled);
  const [reportsEnabled, setReportsEnabled] = useState(initialReportsEnabled);
  const [isHistoryPending, startHistoryTransition] = useTransition();
  const [isAnalyticsPending, startAnalyticsTransition] = useTransition();
  const [isReportsPending, startReportsTransition] = useTransition();

  function onToggleHistory(next: boolean) {
    setHistoryEnabled(next);
    startHistoryTransition(async () => {
      const result = await setHistoryEnabledAction(tenantId, tenantSlug, next);
      if (result.error) {
        setHistoryEnabled(!next);
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
    });
  }

  function onToggleAnalytics(next: boolean) {
    setAnalyticsEnabled(next);
    startAnalyticsTransition(async () => {
      const result = await setAnalyticsEnabledAction(tenantId, tenantSlug, next);
      if (result.error) {
        setAnalyticsEnabled(!next);
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
    });
  }

  function onToggleReports(next: boolean) {
    setReportsEnabled(next);
    startReportsTransition(async () => {
      const result = await setReportsEnabledAction(tenantId, tenantSlug, next);
      if (result.error) {
        setReportsEnabled(!next);
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reporting Tabs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="history-tab-toggle" className="font-normal text-muted-foreground">
            Sales History — show the History tab
          </Label>
          <Switch
            id="history-tab-toggle"
            checked={historyEnabled}
            disabled={isHistoryPending}
            onCheckedChange={onToggleHistory}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <Label htmlFor="analytics-tab-toggle" className="font-normal text-muted-foreground">
            Analytics — show the Analytics tab
          </Label>
          <Switch
            id="analytics-tab-toggle"
            checked={analyticsEnabled}
            disabled={isAnalyticsPending}
            onCheckedChange={onToggleAnalytics}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <Label htmlFor="reports-tab-toggle" className="font-normal text-muted-foreground">
            Reports — show the Reports tab
          </Label>
          <Switch
            id="reports-tab-toggle"
            checked={reportsEnabled}
            disabled={isReportsPending}
            onCheckedChange={onToggleReports}
          />
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setProductRankingEnabledAction } from "@/features/settings/actions/set-product-ranking-enabled";
import { setShowDailySalesVolumeAction } from "@/features/settings/actions/set-show-daily-sales-volume";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Two independent toggles for the Capture Sales landing page (spec item
 * 5): Gold/Silver/Bronze ranking is trailing-30-day revenue, tenant-wide;
 * "today's sales amount" is a separate, always-resets-daily figure,
 * default OFF per the explicit "don't show the day's sales amounts by
 * default" requirement. "Preferred ordering" isn't a third setting here
 * -- turning ranking off falls back to the existing manually-reorderable
 * display_order (Products page, Move Up/Down).
 */
export function ProductRankingCard({
  tenantId,
  tenantSlug,
  initialRankingEnabled,
  initialShowDailyVolume,
}: {
  tenantId: string;
  tenantSlug: string;
  initialRankingEnabled: boolean;
  initialShowDailyVolume: boolean;
}) {
  const [rankingEnabled, setRankingEnabled] = useState(initialRankingEnabled);
  const [showDailyVolume, setShowDailyVolume] = useState(initialShowDailyVolume);
  const [isRankingPending, startRankingTransition] = useTransition();
  const [isVolumePending, startVolumeTransition] = useTransition();

  function onToggleRanking(next: boolean) {
    setRankingEnabled(next);
    startRankingTransition(async () => {
      const result = await setProductRankingEnabledAction(tenantId, tenantSlug, next);
      if (result.error) {
        setRankingEnabled(!next);
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
    });
  }

  function onToggleVolume(next: boolean) {
    setShowDailyVolume(next);
    startVolumeTransition(async () => {
      const result = await setShowDailySalesVolumeAction(tenantId, tenantSlug, next);
      if (result.error) {
        setShowDailyVolume(!next);
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product performance ranking</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="ranking-toggle" className="font-normal text-muted-foreground">
            Automatically rank products (Gold/Silver/Bronze) by sales over the last 30 days
          </Label>
          <Switch
            id="ranking-toggle"
            checked={rankingEnabled}
            disabled={isRankingPending}
            onCheckedChange={onToggleRanking}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <Label htmlFor="daily-volume-toggle" className="font-normal text-muted-foreground">
            Show each product&rsquo;s sales amount for today on the Capture Sales page
          </Label>
          <Switch
            id="daily-volume-toggle"
            checked={showDailyVolume}
            disabled={isVolumePending}
            onCheckedChange={onToggleVolume}
          />
        </div>
      </CardContent>
    </Card>
  );
}

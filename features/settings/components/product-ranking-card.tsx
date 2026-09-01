"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setProductRankingEnabledAction } from "@/features/settings/actions/set-product-ranking-enabled";
import { setShowDailySalesVolumeAction } from "@/features/settings/actions/set-show-daily-sales-volume";
import { setShowProductPriceAction } from "@/features/settings/actions/set-show-product-price";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Three independent toggles for the Capture Sales landing page (spec
 * item 5, plus a later addition): Gold/Silver/Bronze ranking is today's
 * revenue so far, tenant-wide, falling back to yesterday's whenever
 * nothing's been recorded yet today (see lib/utils/product-ranking.ts's
 * own header comment) -- was a flat trailing-30-day window until an
 * explicit request to make it reflect "what's selling right now"
 * instead of a month-long average. "today's sales amount" is a
 * separate, always-resets-daily figure, default OFF per the explicit
 * "don't show the day's sales amounts by default" requirement; "product
 * price" governs the expected-price tag under each product's name on
 * THIS page specifically -- a per-product show/hide flag
 * (products.showExpectedPrice) already exists and still applies
 * everywhere else (e.g. the Record Sale dialog's own price line); this
 * tenant-wide switch is a second, coarser gate on top of it, scoped only
 * to the landing page grid, default ON to match every tenant's existing
 * behavior before this setting existed. "Preferred ordering" isn't a
 * fourth setting here -- turning ranking off falls back to the existing
 * manually-reorderable display_order (Products page, Move Up/Down).
 */
export function ProductRankingCard({
  tenantId,
  tenantSlug,
  initialRankingEnabled,
  initialShowDailyVolume,
  initialShowProductPrice,
}: {
  tenantId: string;
  tenantSlug: string;
  initialRankingEnabled: boolean;
  initialShowDailyVolume: boolean;
  initialShowProductPrice: boolean;
}) {
  const [rankingEnabled, setRankingEnabled] = useState(initialRankingEnabled);
  const [showDailyVolume, setShowDailyVolume] = useState(initialShowDailyVolume);
  const [showProductPrice, setShowProductPrice] = useState(initialShowProductPrice);
  const [isRankingPending, startRankingTransition] = useTransition();
  const [isVolumePending, startVolumeTransition] = useTransition();
  const [isPricePending, startPriceTransition] = useTransition();

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

  function onTogglePrice(next: boolean) {
    setShowProductPrice(next);
    startPriceTransition(async () => {
      const result = await setShowProductPriceAction(tenantId, tenantSlug, next);
      if (result.error) {
        setShowProductPrice(!next);
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
            Automatically rank products (Gold/Silver/Bronze) by today&rsquo;s sales so far, or yesterday&rsquo;s if
            nothing&rsquo;s been recorded yet today
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

        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <Label htmlFor="product-price-toggle" className="font-normal text-muted-foreground">
            Show each product&rsquo;s price on the Capture Sales page
          </Label>
          <Switch
            id="product-price-toggle"
            checked={showProductPrice}
            disabled={isPricePending}
            onCheckedChange={onTogglePrice}
          />
        </div>
      </CardContent>
    </Card>
  );
}

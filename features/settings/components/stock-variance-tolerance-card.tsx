"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setStockVarianceToleranceAction } from "@/features/settings/actions/set-stock-variance-tolerance";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function StockVarianceToleranceCard({
  tenantId,
  tenantSlug,
  initialTolerancePercent,
  initialToleranceAmount,
}: {
  tenantId: string;
  tenantSlug: string;
  initialTolerancePercent: number | null;
  initialToleranceAmount: number | null;
}) {
  const [tolerancePercent, setTolerancePercent] = useState(String(initialTolerancePercent ?? 2));
  const [toleranceAmount, setToleranceAmount] = useState(String(initialToleranceAmount ?? 0));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("tolerancePercent", tolerancePercent);
    formData.set("toleranceAmount", toleranceAmount);

    startTransition(async () => {
      const result = await setStockVarianceToleranceAction(tenantId, tenantSlug, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast.success("Saved");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock variance tolerance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          A reconciliation&rsquo;s variance is flagged Green (balanced/within tolerance), Amber, or Red (material) using
          whichever of these two limits is reached first -- a variance under both is within tolerance.
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="tolerance-percent">Tolerance (% of expected)</Label>
              <Input
                id="tolerance-percent"
                type="number"
                min="0"
                step="0.1"
                value={tolerancePercent}
                onChange={(e) => setTolerancePercent(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tolerance-amount">Tolerance (flat amount)</Label>
              <Input
                id="tolerance-amount"
                type="number"
                min="0"
                step="0.01"
                value={toleranceAmount}
                onChange={(e) => setToleranceAmount(e.target.value)}
                required
              />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setSaleDateSelectionAction } from "@/features/settings/actions/set-sale-date-selection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const MAX_BACKDATING_LABEL: Record<string, string> = {
  "1": "1 day",
  "3": "3 days",
  "7": "7 days",
  "30": "30 days",
  unlimited: "Unlimited",
};

/**
 * Who can actually pick a past date is controlled from Roles &
 * Permissions ("Record a new sale directly onto a past date") -- this
 * card only configures WHETHER the field appears at all (tenant-wide,
 * off by default -- the normal fast Record Sale flow is unaffected
 * either way) and, when on, how far back it can go.
 */
export function SaleDateSelectionCard({
  tenantId,
  tenantSlug,
  initialEnabled,
  initialMaxBackdatingDays,
}: {
  tenantId: string;
  tenantSlug: string;
  initialEnabled: boolean;
  initialMaxBackdatingDays: number | null;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [maxBackdatingDays, setMaxBackdatingDays] = useState(
    initialMaxBackdatingDays === null || initialMaxBackdatingDays <= 0 ? "unlimited" : String(initialMaxBackdatingDays)
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("enabled", String(enabled));
    formData.set("maxBackdatingDays", maxBackdatingDays === "unlimited" ? "-1" : maxBackdatingDays);

    startTransition(async () => {
      const result = await setSaleDateSelectionAction(tenantId, tenantSlug, {}, formData);
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
        <CardTitle>Sale date selection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="sale-date-selection-toggle" className="font-normal text-muted-foreground">
              Allow choosing a past date when recording a sale. When off, every sale is recorded for today.
            </Label>
            <Switch
              id="sale-date-selection-toggle"
              checked={enabled}
              disabled={isPending}
              onCheckedChange={setEnabled}
            />
          </div>

          {enabled && (
            <div className="space-y-2 border-t pt-4">
              <Label>Maximum backdating period</Label>
              <Select
                value={maxBackdatingDays}
                onValueChange={(v) => v && setMaxBackdatingDays(v)}
                disabled={isPending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: string) => MAX_BACKDATING_LABEL[v]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 day</SelectItem>
                  <SelectItem value="3">3 days</SelectItem>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="unlimited">Unlimited</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Only roles with &ldquo;Record a new sale directly onto a past date&rdquo; (Roles &amp; Permissions)
                can actually use this once enabled.
              </p>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

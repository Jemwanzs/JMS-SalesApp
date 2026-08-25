"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { updateBusinessHoursAction } from "@/features/workspace/actions/update-business-hours";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

interface DayHours {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  closedAllDay: boolean;
}

/**
 * Same shape as onboarding's LocationHoursStep, pre-filled with what's
 * actually saved (TenantService.getLocationHours) instead of that
 * step's blank/"Head Office, Sunday closed" starting defaults, since
 * this is an edit of a real, already-configured location.
 */
export function BusinessHoursForm({
  tenantId,
  tenantSlug,
  initial,
}: {
  tenantId: string;
  tenantSlug: string;
  initial: { locationName: string; address: string; hours: DayHours[] };
}) {
  const [isPending, startTransition] = useTransition();
  const [locationName, setLocationName] = useState(initial.locationName);
  const [address, setAddress] = useState(initial.address);
  const [hours, setHours] = useState<DayHours[]>(initial.hours);
  const [error, setError] = useState<string | null>(null);

  function updateDay(dayOfWeek: number, patch: Partial<DayHours>) {
    setHours((prev) =>
      prev.map((h) => (h.dayOfWeek === dayOfWeek ? { ...h, ...patch } : h))
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("locationName", locationName);
    formData.set("address", address);
    formData.set("hours", JSON.stringify(hours));

    startTransition(async () => {
      const result = await updateBusinessHoursAction(tenantId, tenantSlug, {}, formData);

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Please check your entries");
        return;
      }

      if (result.success) {
        toast.success("Business hours updated");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Business hours</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="locationName">Location name</Label>
            <Input
              id="locationName"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, city"
              required
            />
          </div>

          <div className="space-y-3">
            <Label>Working days &amp; hours</Label>
            {hours.map((day) => (
              <div key={day.dayOfWeek} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0">{DAY_LABELS[day.dayOfWeek]}</span>
                {day.closedAllDay ? (
                  <span className="flex-1 text-muted-foreground">Closed</span>
                ) : (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      type="time"
                      value={day.openTime}
                      onChange={(e) =>
                        updateDay(day.dayOfWeek, { openTime: e.target.value })
                      }
                      className="h-8"
                    />
                    <span className="text-muted-foreground">–</span>
                    <Input
                      type="time"
                      value={day.closeTime}
                      onChange={(e) =>
                        updateDay(day.dayOfWeek, { closeTime: e.target.value })
                      }
                      className="h-8"
                    />
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <Switch
                    checked={!day.closedAllDay}
                    onCheckedChange={(checked) =>
                      updateDay(day.dayOfWeek, { closedAllDay: !checked })
                    }
                  />
                </div>
              </div>
            ))}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving..." : "Save changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

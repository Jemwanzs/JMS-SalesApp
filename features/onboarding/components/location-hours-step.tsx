"use client";

import { useState, useTransition } from "react";

import { saveLocationHoursAction } from "@/features/onboarding/actions/save-location-hours";
import { Button } from "@/components/ui/button";
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

function defaultHours(): DayHours[] {
  return DAY_LABELS.map((_, dayOfWeek) => ({
    dayOfWeek,
    openTime: "08:00",
    closeTime: "17:00",
    closedAllDay: dayOfWeek === 0, // Sunday closed by default, matches spec S64's example
  }));
}

export function LocationHoursStep({
  tenantId,
  onSaved,
}: {
  tenantId: string;
  onSaved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [locationName, setLocationName] = useState("Head Office");
  const [address, setAddress] = useState("");
  const [hours, setHours] = useState<DayHours[]>(defaultHours());
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
      const result = await saveLocationHoursAction(tenantId, {}, formData);

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Please check your entries");
        return;
      }

      if (result.success) {
        onSaved();
      }
    });
  }

  return (
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
        <Label>Business hours</Label>
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

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Saving..." : "Continue"}
      </Button>
    </form>
  );
}

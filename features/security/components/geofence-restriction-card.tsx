"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setGeofenceRestrictionAction } from "@/features/security/actions/set-geofence-restriction";
import { setLocationGeofenceAction } from "@/features/security/actions/set-location-geofence";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Phase 4: only the login-time half of docs/05's geo-fencing restriction
 * (AuthService.evaluateAccessGate's geofence check) plus the config UI
 * for the fence itself -- the in-session countdown/expiry warning for an
 * active temporary-access grant is deferred the same way 4e deferred it
 * for working hours (see working-hours-restriction-toggle.tsx).
 */
export function GeofenceRestrictionCard({
  tenantId,
  tenantSlug,
  initialEnabled,
  initialLatitude,
  initialLongitude,
  initialRadiusMeters,
}: {
  tenantId: string;
  tenantSlug: string;
  initialEnabled: boolean;
  initialLatitude: number | null;
  initialLongitude: number | null;
  initialRadiusMeters: number | null;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isTogglePending, startToggleTransition] = useTransition();
  const [isSavePending, startSaveTransition] = useTransition();
  const [latitude, setLatitude] = useState(initialLatitude?.toString() ?? "");
  const [longitude, setLongitude] = useState(initialLongitude?.toString() ?? "");
  const [radiusMeters, setRadiusMeters] = useState(initialRadiusMeters?.toString() ?? "150");
  const [saveError, setSaveError] = useState<string | null>(null);

  function onToggle(next: boolean) {
    setEnabled(next);
    startToggleTransition(async () => {
      try {
        await setGeofenceRestrictionAction(tenantId, tenantSlug, next);
        toast.success(next ? "Login restricted to this location" : "Location restriction removed");
      } catch (err) {
        setEnabled(!next);
        toast.error(err instanceof Error ? err.message : "Could not update setting");
      }
    });
  }

  function useCurrentLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setLatitude(pos.coords.latitude.toString());
      setLongitude(pos.coords.longitude.toString());
    });
  }

  function onSaveFence(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);

    const formData = new FormData();
    formData.set("latitude", latitude);
    formData.set("longitude", longitude);
    formData.set("radiusMeters", radiusMeters);

    startSaveTransition(async () => {
      const result = await setLocationGeofenceAction(tenantId, tenantSlug, {}, formData);
      if (result.error) {
        setSaveError(result.error);
        return;
      }
      toast.success("Geofence saved");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Location-based login restriction</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="geofence-toggle" className="font-normal text-muted-foreground">
            Only allow sign-in from your primary location&rsquo;s allowed radius
          </Label>
          <Switch
            id="geofence-toggle"
            checked={enabled}
            disabled={isTogglePending}
            onCheckedChange={onToggle}
          />
        </div>

        <form onSubmit={onSaveFence} className="space-y-2 border-t pt-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="geofence-lat" className="text-xs">Latitude</Label>
              <Input
                id="geofence-lat"
                type="number"
                step="any"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="geofence-lng" className="text-xs">Longitude</Label>
              <Input
                id="geofence-lng"
                type="number"
                step="any"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="geofence-radius" className="text-xs">Radius (m)</Label>
              <Input
                id="geofence-radius"
                type="number"
                min={1}
                max={50000}
                value={radiusMeters}
                onChange={(e) => setRadiusMeters(e.target.value)}
                required
              />
            </div>
          </div>
          {saveError && <p className="text-xs text-destructive">{saveError}</p>}
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={useCurrentLocation}>
              Use my current location
            </Button>
            <Button type="submit" size="sm" disabled={isSavePending}>
              {isSavePending ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

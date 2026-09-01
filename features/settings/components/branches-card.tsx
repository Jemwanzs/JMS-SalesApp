"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { deactivateLocationAction, reactivateLocationAction } from "@/features/settings/actions/manage-locations";
import { BranchFormDialog } from "@/features/settings/components/branch-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LocationSummary } from "@/services/LocationService";

/**
 * Multi-Branch User Access Phase 2 -- the branch-management UI the app
 * never had. Onboarding's LocationHoursStep still creates a tenant's
 * FIRST branch (TenantService.upsertPrimaryLocation, unchanged); this
 * card is for the second one onward. A tenant that never adds a second
 * branch never has a reason to open this card -- single-branch tenants
 * see zero behavior change anywhere else in the app (Phase 4's Select
 * Branch screen only ever appears for someone assigned to 2+ branches).
 */
export function BranchesCard({
  tenantId,
  tenantSlug,
  initialLocations,
}: {
  tenantId: string;
  tenantSlug: string;
  initialLocations: LocationSummary[];
}) {
  const [locations, setLocations] = useState(initialLocations);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    // Server actions already revalidatePath the settings route -- a
    // full reload of this card's own data happens on next navigation;
    // for the immediate optimistic view, just re-fetch is overkill for
    // a settings card, so this reloads the page data via a soft nav.
    window.location.reload();
  }

  function onToggleActive(location: LocationSummary) {
    const nextActive = location.status !== "active";
    startTransition(async () => {
      const action = nextActive ? reactivateLocationAction : deactivateLocationAction;
      const result = await action(tenantId, tenantSlug, location.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setLocations((prev) =>
        prev.map((l) => (l.id === location.id ? { ...l, status: nextActive ? "active" : "inactive" } : l))
      );
      toast.success(nextActive ? "Branch reactivated" : "Branch deactivated");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branches</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          A user assigned to more than one branch picks which one to work in at login -- switching branches means
          logging out and back in, not an in-app switch.
        </p>

        <div className="divide-y rounded-lg border">
          {locations.map((location) => (
            <div key={location.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{location.name}</p>
                  <Badge variant={location.status === "active" ? "default" : "secondary"}>{location.status}</Badge>
                </div>
                {location.address && <p className="truncate text-xs text-muted-foreground">{location.address}</p>}
              </div>
              <BranchFormDialog
                tenantId={tenantId}
                tenantSlug={tenantSlug}
                location={location}
                trigger={
                  <button type="button" aria-label={`Edit ${location.name}`} className="shrink-0 text-muted-foreground hover:text-foreground">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                }
                onSaved={refresh}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => onToggleActive(location)}
              >
                {location.status === "active" ? "Deactivate" : "Reactivate"}
              </Button>
            </div>
          ))}
        </div>

        <BranchFormDialog
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          trigger={
            <Button variant="outline" className="w-full">
              <Plus className="h-4 w-4" />
              Add branch
            </Button>
          }
          onSaved={refresh}
        />
      </CardContent>
    </Card>
  );
}

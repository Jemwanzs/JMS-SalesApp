"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setSaleEditingDeletionAction } from "@/features/settings/actions/set-sale-editing-deletion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type EditWindowMode = "business_day" | "hours";

const EDIT_WINDOW_MODE_LABEL: Record<EditWindowMode, string> = {
  business_day: "The same business day (default)",
  hours: "A fixed number of hours",
};

/**
 * Who can correct/delete a sale is a Roles & Permissions concern
 * (Edit / Correct Sales, Delete Sales); this card only configures WHEN --
 * the tenant-wide window each of those permissions is bounded by, read
 * by correct_sale()/delete_sale() (migration 0074) at enforcement time.
 */
export function SaleEditingDeletionCard({
  tenantId,
  tenantSlug,
  initialEditWindowMode,
  initialEditWindowHours,
  initialDeletionEnabled,
  initialDeleteWindowMinutes,
}: {
  tenantId: string;
  tenantSlug: string;
  initialEditWindowMode: EditWindowMode;
  initialEditWindowHours: number;
  initialDeletionEnabled: boolean;
  initialDeleteWindowMinutes: number;
}) {
  const [editWindowMode, setEditWindowMode] = useState<EditWindowMode>(initialEditWindowMode);
  const [editWindowHours, setEditWindowHours] = useState(String(initialEditWindowHours));
  const [deletionEnabled, setDeletionEnabled] = useState(initialDeletionEnabled);
  const [deleteWindowMinutes, setDeleteWindowMinutes] = useState(String(initialDeleteWindowMinutes));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("editWindowMode", editWindowMode);
    formData.set("editWindowHours", editWindowHours);
    formData.set("deletionEnabled", String(deletionEnabled));
    formData.set("deleteWindowMinutes", deleteWindowMinutes);

    startTransition(async () => {
      const result = await setSaleEditingDeletionAction(tenantId, tenantSlug, {}, formData);
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
        <CardTitle>Sale editing &amp; deletion</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Who can correct or delete a sale is controlled from Roles &amp; Permissions (&ldquo;Edit / Correct
          Sales&rdquo;, &ldquo;Delete Sales&rdquo;) -- this only configures the time window each of those
          permissions is bounded by.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Allow sale editing within</Label>
            <Select value={editWindowMode} onValueChange={(v) => setEditWindowMode(v as EditWindowMode)} disabled={isPending}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: EditWindowMode) => EDIT_WINDOW_MODE_LABEL[v]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="business_day">The same business day (default)</SelectItem>
                <SelectItem value="hours">A fixed number of hours</SelectItem>
              </SelectContent>
            </Select>
            {editWindowMode === "business_day" ? (
              <p className="text-xs text-muted-foreground">
                A sale can be corrected while the business day it was recorded in is still open. Once that day
                closes, only a role with &ldquo;Correct a sale after the edit window has closed&rdquo; can still
                fix it.
              </p>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="edit-window-hours" className="text-xs">
                  Edit sale within (hours)
                </Label>
                <Input
                  id="edit-window-hours"
                  type="number"
                  min="1"
                  step="1"
                  value={editWindowHours}
                  onChange={(e) => setEditWindowHours(e.target.value)}
                  disabled={isPending}
                  required
                />
              </div>
            )}
          </div>

          <div className="space-y-2 border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="deletion-enabled" className="font-normal text-muted-foreground">
                Allow sale deletion
              </Label>
              <Switch id="deletion-enabled" checked={deletionEnabled} disabled={isPending} onCheckedChange={setDeletionEnabled} />
            </div>
            {deletionEnabled && (
              <div className="space-y-1">
                <Label htmlFor="delete-window-minutes" className="text-xs">
                  Delete sale within (minutes)
                </Label>
                <Input
                  id="delete-window-minutes"
                  type="number"
                  min="0"
                  step="1"
                  value={deleteWindowMinutes}
                  onChange={(e) => setDeleteWindowMinutes(e.target.value)}
                  disabled={isPending}
                  required
                />
                <p className="text-xs text-muted-foreground">0 minutes effectively disables deletion.</p>
              </div>
            )}
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

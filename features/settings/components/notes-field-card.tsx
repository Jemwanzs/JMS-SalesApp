"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setNotesFieldEnabledAction } from "@/features/settings/actions/set-notes-field-enabled";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function NotesFieldCard({
  tenantId,
  tenantSlug,
  initialEnabled,
}: {
  tenantId: string;
  tenantSlug: string;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();

  function onToggle(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      const result = await setNotesFieldEnabledAction(tenantId, tenantSlug, next);
      if (result.error) {
        setEnabled(!next);
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes field</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="notes-toggle" className="font-normal text-muted-foreground">
            Show an optional notes field when recording a sale. When off, the field is hidden.
          </Label>
          <Switch
            id="notes-toggle"
            checked={enabled}
            disabled={isPending}
            onCheckedChange={onToggle}
          />
        </div>
      </CardContent>
    </Card>
  );
}

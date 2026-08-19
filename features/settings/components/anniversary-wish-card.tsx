"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setAnniversaryWishModeAction } from "@/features/settings/actions/set-anniversary-wish-mode";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AnniversaryWishMode } from "@/services/AnniversaryService";

const MODE_LABEL: Record<AnniversaryWishMode, string> = {
  automatic: "Automatic",
  review: "Review before sending",
  disabled: "Disabled",
};

const MODE_DESCRIPTION: Record<AnniversaryWishMode, string> = {
  automatic: "A congratulatory message is sent automatically on your business anniversary each year.",
  review: "A message is prepared ahead of time, but a platform administrator reviews and sends it manually.",
  disabled: "No anniversary wish is scheduled or sent.",
};

export function AnniversaryWishCard({
  tenantId,
  tenantSlug,
  anniversaryDate,
  currentMode,
}: {
  tenantId: string;
  tenantSlug: string;
  anniversaryDate: string | null;
  currentMode: AnniversaryWishMode;
}) {
  const [mode, setMode] = useState(currentMode);
  const [isPending, startTransition] = useTransition();

  function onChange(next: AnniversaryWishMode) {
    setMode(next);
    startTransition(async () => {
      const result = await setAnniversaryWishModeAction(tenantId, tenantSlug, next);
      if (result.error) {
        toast.error(result.error);
        setMode(currentMode);
        return;
      }
      toast.success("Saved");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Business anniversary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {anniversaryDate ? (
          <p className="text-sm text-muted-foreground">
            Your business anniversary is set to {new Date(`${anniversaryDate}T00:00:00Z`).toLocaleDateString(undefined, { month: "long", day: "numeric" })}.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No anniversary date on file yet — set one from your business details.</p>
        )}

        <div className="space-y-1">
          <Select value={mode} onValueChange={(v) => onChange(v as AnniversaryWishMode)} disabled={isPending || !anniversaryDate}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODE_LABEL) as AnniversaryWishMode[]).map((m) => (
                <SelectItem key={m} value={m}>
                  {MODE_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{MODE_DESCRIPTION[mode]}</p>
        </div>
      </CardContent>
    </Card>
  );
}

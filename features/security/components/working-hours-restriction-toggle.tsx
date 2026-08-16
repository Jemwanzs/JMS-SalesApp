"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setWorkingHoursRestrictionAction } from "@/features/security/actions/set-working-hours-restriction";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Phase 4e: only the login-time half of docs/05-authentication-security
 * .md's working-hours restriction (AuthService.evaluateAccessGate) --
 * the in-session countdown-warning-then-sign-out half is a separate,
 * deliberately deferred client-timer feature, not built here.
 */
export function WorkingHoursRestrictionToggle({
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

  function onChange(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      try {
        await setWorkingHoursRestrictionAction(tenantId, tenantSlug, next);
        toast.success(next ? "Login restricted to business hours" : "Login restriction removed");
      } catch (err) {
        setEnabled(!next);
        toast.error(err instanceof Error ? err.message : "Could not update setting");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Working-hours login restriction</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="working-hours-toggle" className="font-normal text-muted-foreground">
            Only allow sign-in during your primary location&rsquo;s configured hours
          </Label>
          <Switch
            id="working-hours-toggle"
            checked={enabled}
            disabled={isPending}
            onCheckedChange={onChange}
          />
        </div>
      </CardContent>
    </Card>
  );
}

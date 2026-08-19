"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setDownloadPasscodeAction } from "@/features/security/actions/set-download-passcode";
import { setDownloadPasscodeRequirementAction } from "@/features/security/actions/set-download-passcode-requirement";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * docs/05's "Download security" section: require_download_passcode
 * (this toggle) + hashed_download_passcode (set/changed here, never
 * displayed back — only "set" or "not set", matching the password-
 * visibility boundary every other secret in this app follows).
 * Currently applied to the one real export surface (Sales History's
 * CSV button) -- see export-sales-history.ts.
 *
 * This same passcode also doubles as Phase 2h's business-day reopen
 * fallback gate (docs/09-business-day-engine.md: "MFA or passcode") for
 * a team member who hasn't enrolled in two-factor authentication — one
 * memorized passcode covers both, rather than a second one to configure
 * here. The toggle above only governs *downloads*; reopening always
 * checks the passcode when MFA isn't available, with no separate switch.
 */
export function DownloadSecurityCard({
  tenantId,
  tenantSlug,
  initialEnabled,
  passcodeConfigured,
}: {
  tenantId: string;
  tenantSlug: string;
  initialEnabled: boolean;
  passcodeConfigured: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isTogglePending, startToggleTransition] = useTransition();
  const [isSavePending, startSaveTransition] = useTransition();
  const [passcode, setPasscode] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(passcodeConfigured);

  function onToggle(next: boolean) {
    setEnabled(next);
    startToggleTransition(async () => {
      try {
        await setDownloadPasscodeRequirementAction(tenantId, tenantSlug, next);
        toast.success(next ? "Downloads now require a passcode" : "Download passcode requirement removed");
      } catch (err) {
        setEnabled(!next);
        toast.error(err instanceof Error ? err.message : "Could not update setting");
      }
    });
  }

  function onSavePasscode(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);

    const formData = new FormData();
    formData.set("passcode", passcode);

    startSaveTransition(async () => {
      const result = await setDownloadPasscodeAction(tenantId, tenantSlug, {}, formData);
      if (result.error) {
        setSaveError(result.error);
        return;
      }
      setPasscode("");
      setConfigured(true);
      toast.success("Download passcode updated");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Download security</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="download-passcode-toggle" className="font-normal text-muted-foreground">
            Require a passcode before exporting data
          </Label>
          <Switch
            id="download-passcode-toggle"
            checked={enabled}
            disabled={isTogglePending}
            onCheckedChange={onToggle}
          />
        </div>

        <form onSubmit={onSavePasscode} className="space-y-2 border-t pt-3">
          <Label htmlFor="download-passcode" className="text-xs">
            {configured ? "Change passcode" : "Set passcode"}
          </Label>
          <div className="flex gap-2">
            <Input
              id="download-passcode"
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder={configured ? "New passcode" : "Passcode"}
            />
            <Button type="submit" size="sm" disabled={isSavePending || !passcode}>
              {isSavePending ? "Saving..." : "Save"}
            </Button>
          </div>
          {saveError && <p className="text-xs text-destructive">{saveError}</p>}
          <p className="text-xs text-muted-foreground">
            This passcode is also used to reopen a closed business day when two-factor authentication isn&rsquo;t enabled.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

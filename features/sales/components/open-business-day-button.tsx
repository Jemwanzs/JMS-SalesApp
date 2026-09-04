"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { openBusinessDayAction } from "@/features/sales/actions/open-business-day";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Plain instant-open button when the tenant has never created a
 * security passcode (`requiresPasscode`, from whether
 * hashed_download_passcode exists at all -- see sales/page.tsx and
 * open-business-day.ts) -- unchanged behavior from before this gate
 * existed. When a passcode HAS been created, opens a small dialog for
 * it first instead, mirroring reopen-business-day-dialog.tsx's own
 * passcode step (same tenant-wide passcode, no separate one to
 * configure) -- deliberately no MFA alternative here, unlike reopen:
 * opening is a routine everyday action, not the "highly privileged"
 * reopen-a-closed-day case docs/09-business-day-engine.md always gates
 * one way or another.
 */
export function OpenBusinessDayButton({
  tenantId,
  tenantSlug,
  locationId,
  requiresPasscode,
}: {
  tenantId: string;
  tenantSlug: string;
  locationId: string;
  requiresPasscode: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("Sales");

  function submitOpen(withPasscode?: string) {
    startTransition(async () => {
      const result = await openBusinessDayAction(tenantId, tenantSlug, locationId, withPasscode);
      if (result.error) {
        if (requiresPasscode) {
          setError(result.error);
        } else {
          toast.error(result.error);
        }
        return;
      }
      setOpen(false);
      setPasscode("");
      setError(null);
    });
  }

  if (!requiresPasscode) {
    return (
      <Button data-tour-id="tour-open-day-button" onClick={() => submitOpen()} disabled={isPending} className="w-full">
        {isPending ? t("opening") : t("openBusinessDay")}
      </Button>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setPasscode("");
          setError(null);
        }
      }}
    >
      <DialogTrigger render={<Button data-tour-id="tour-open-day-button" className="w-full" />}>
        {t("openBusinessDay")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("openBusinessDay")}</DialogTitle>
          <DialogDescription>{t("openBusinessDayPasscodeHelper")}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitOpen(passcode);
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="open-passcode">{t("securityPasscode")}</Label>
            <Input
              id="open-passcode"
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              autoFocus
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? t("opening") : t("verifyAndOpen")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

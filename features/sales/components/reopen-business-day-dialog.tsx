"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { reopenBusinessDayAction } from "@/features/sales/actions/reopen-business-day";
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
import { createClient } from "@/lib/supabase/client";

function defaultUntilTime(): string {
  const inOneHour = new Date(Date.now() + 60 * 60 * 1000);
  return `${String(inOneHour.getHours()).padStart(2, "0")}:${String(inOneHour.getMinutes()).padStart(2, "0")}`;
}

type Step = "details" | "mfa" | "passcode";

/**
 * Reopening is "highly privileged" (docs/09-business-day-engine.md):
 * reason + a bounded window are already gated by reopenBusinessDaySchema/
 * reopen_business_day() (migration 0009); this component adds the doc's
 * other requirement, "MFA or passcode" -- a real Supabase Auth TOTP step
 * -up when the signed-in user has one enrolled (same client-side
 * challengeAndVerify() pattern as features/security/components/
 * mfa-enrollment.tsx and Phase 7b's impersonation gate), falling back to
 * the tenant's existing security passcode (Security Centre's download-
 * security card) when they don't. The server independently re-verifies
 * whichever one was actually used -- this dialog's own factor check just
 * decides which prompt to show, it isn't trusted as proof by itself.
 */
export function ReopenBusinessDayDialog({
  businessDayId,
  tenantId,
  tenantSlug,
}: {
  businessDayId: string;
  tenantId: string;
  tenantSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("details");
  const [reason, setReason] = useState("");
  const [untilTime, setUntilTime] = useState(defaultUntilTime);
  const [code, setCode] = useState("");
  const [passcode, setPasscode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("Sales");
  const tCommon = useTranslations("Common");

  function reset() {
    setStep("details");
    setReason("");
    setUntilTime(defaultUntilTime());
    setCode("");
    setPasscode("");
    setFactorId(null);
    setError(null);
  }

  function computeUntil(): Date {
    const [hours, minutes] = untilTime.split(":").map(Number);
    const until = new Date();
    until.setHours(hours, minutes, 0, 0);
    if (until.getTime() <= Date.now()) {
      until.setDate(until.getDate() + 1);
    }
    return until;
  }

  async function onContinue(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const supabase = createClient();
    const { data } = await supabase.auth.mfa.listFactors();
    const verified = data?.totp?.find((f) => f.status === "verified") ?? null;

    if (verified) {
      setFactorId(verified.id);
      setStep("mfa");
    } else {
      setStep("passcode");
    }
  }

  function submitReopen(extra: Record<string, string>) {
    const formData = new FormData();
    formData.set("businessDayId", businessDayId);
    formData.set("reason", reason);
    formData.set("until", computeUntil().toISOString());
    for (const [key, value] of Object.entries(extra)) {
      formData.set(key, value);
    }

    startTransition(async () => {
      const result = await reopenBusinessDayAction(tenantId, tenantSlug, {}, formData);

      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? tCommon("checkEntries"));
        return;
      }
      if (result.result) {
        setOpen(false);
        reset();

        if (result.result.status === "pending_approval") {
          toast(t("submittedForApproval"), {
            description: t("submittedForApprovalDescription"),
          });
        } else {
          toast.success(t("businessDayReopened"));
        }
      }
    });
  }

  function onSubmitMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);

    startTransition(async () => {
      const supabase = createClient();
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (verifyError) {
        setError(verifyError.message);
        return;
      }
      submitReopen({});
    });
  }

  function onSubmitPasscode(e: React.FormEvent) {
    e.preventDefault();
    submitReopen({ passcode });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button variant="outline" className="w-full" />}>
        {t("reopenBusinessDay")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("reopenThisBusinessDay")}</DialogTitle>
          <DialogDescription>
            {t("reopenDescription")}
          </DialogDescription>
        </DialogHeader>

        {step === "details" && (
          <form onSubmit={onContinue} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reopen-reason">{t("reason")}</Label>
              <Input id="reopen-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reopen-until">{t("reopenUntil")}</Label>
              <Input id="reopen-until" type="time" value={untilTime} onChange={(e) => setUntilTime(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={!reason.trim()}>
                {t("continue")}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === "mfa" && (
          <form onSubmit={onSubmitMfa} className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("mfaHelper")}</p>
            <div className="space-y-2">
              <Label htmlFor="reopen-mfa-code">{t("sixDigitCode")}</Label>
              <Input id="reopen-mfa-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} autoFocus required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? t("reopening") : t("verifyAndReopen")}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === "passcode" && (
          <form onSubmit={onSubmitPasscode} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("passcodeHelper")}
            </p>
            <div className="space-y-2">
              <Label htmlFor="reopen-passcode">{t("securityPasscode")}</Label>
              <Input id="reopen-passcode" type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoFocus required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? t("reopening") : t("verifyAndReopen")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

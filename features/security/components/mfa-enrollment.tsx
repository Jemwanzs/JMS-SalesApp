"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

/**
 * Phase 4c(ii): MFA enrollment (docs/05-authentication-security.md --
 * TOTP via Supabase Auth). Scoped to enrollment/disablement itself, not
 * enforcement -- MFA stays "optional" everywhere today; wiring it as a
 * *requirement* for business-day reopen / security.manage-gated actions
 * / platform-admin impersonation is a separate follow-up once this
 * exists to require, per docs/05's own phrasing and 2h's already-
 * documented deferral.
 *
 * Deliberately calls `supabase.auth.mfa.*` directly on the browser
 * client (lib/supabase/client.ts) rather than through a server action or
 * service wrapper -- same precedent as product-image-upload.tsx's direct
 * Storage calls: this is a pure client-SDK passthrough against the
 * caller's OWN session, no service-role privilege or server-side DB
 * write involved at any step (Supabase manages `auth.mfa_factors`
 * internally; this project's own hard rule already forbids reading that
 * schema directly regardless -- see docs/05).
 *
 * Disabling requires a fresh TOTP code (a step-up challenge) even though
 * the user is already signed in -- both because Supabase's unenroll can
 * require AAL2 for a verified factor, and because it's simply the right
 * UX for removing a security control regardless of whether the API
 * strictly demands it.
 */
type Step = "idle" | "enrolling" | "disabling";

export function MfaEnrollment() {
  const [step, setStep] = useState<Step>("idle");
  const [loading, setLoading] = useState(true);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function refreshStatus() {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase.auth.mfa.listFactors();
    const verifiedTotp = data?.totp?.find((f) => f.status === "verified") ?? null;
    setFactorId(verifiedTotp?.id ?? null);
    setLoading(false);
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  async function onStartEnroll() {
    setError(null);
    setIsPending(true);
    const supabase = createClient();

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator (${new Date().toLocaleDateString()})`,
    });

    setIsPending(false);
    if (enrollError || !data) {
      setError(enrollError?.message ?? "Could not start enrollment");
      return;
    }

    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    setStep("enrolling");
  }

  async function onCancelEnroll() {
    if (factorId) {
      await createClient().auth.mfa.unenroll({ factorId }).catch(() => {});
    }
    setStep("idle");
    setFactorId(null);
    setQrCode(null);
    setSecret(null);
    setCode("");
    setError(null);
    await refreshStatus();
  }

  async function onVerifyEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setIsPending(true);

    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({
      factorId,
      code,
    });

    setIsPending(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }

    toast.success("Two-factor authentication enabled");
    setStep("idle");
    setQrCode(null);
    setSecret(null);
    setCode("");
    await refreshStatus();
  }

  async function onVerifyDisable(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setIsPending(true);

    const supabase = createClient();
    const { error: stepUpError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (stepUpError) {
      setIsPending(false);
      setError(stepUpError.message);
      return;
    }

    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId });
    setIsPending(false);
    if (unenrollError) {
      setError(unenrollError.message);
      return;
    }

    toast.success("Two-factor authentication disabled");
    setStep("idle");
    setCode("");
    await refreshStatus();
  }

  if (loading) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor authentication</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {step === "idle" && (
          <>
            <p className="text-sm text-muted-foreground">
              {factorId
                ? "Enabled. You'll be asked for a code from your authenticator app for sensitive actions once this is enforced."
                : "Not enabled. Add an authenticator app for an extra layer of security."}
            </p>
            {factorId ? (
              <Button variant="outline" size="sm" onClick={() => setStep("disabling")}>
                Disable
              </Button>
            ) : (
              <Button size="sm" disabled={isPending} onClick={onStartEnroll}>
                {isPending ? "Starting..." : "Enable two-factor authentication"}
              </Button>
            )}
          </>
        )}

        {step === "enrolling" && qrCode && (
          <form onSubmit={onVerifyEnroll} className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Scan this QR code with your authenticator app, then enter the 6-digit code it shows.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URI SVG from Supabase, next/image needs remote-pattern config for arbitrary sources */}
            <img src={qrCode} alt="MFA QR code" className="mx-auto h-40 w-40" />
            {secret && (
              <p className="break-all text-center text-xs text-muted-foreground">
                Or enter this key manually: {secret}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="mfa-enroll-code">6-digit code</Label>
              <Input
                id="mfa-enroll-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                autoFocus
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "Verifying..." : "Verify & enable"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onCancelEnroll}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {step === "disabling" && (
          <form onSubmit={onVerifyDisable} className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Enter a current code from your authenticator app to confirm disabling two-factor
              authentication.
            </p>
            <div className="space-y-2">
              <Label htmlFor="mfa-disable-code">6-digit code</Label>
              <Input
                id="mfa-disable-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                autoFocus
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="destructive" disabled={isPending}>
                {isPending ? "Disabling..." : "Confirm disable"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStep("idle");
                  setCode("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

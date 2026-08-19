"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { startImpersonationAction } from "@/features/platform-admin/actions/start-impersonation";
import { createClient } from "@/lib/supabase/client";

type Step = "closed" | "reason" | "enroll" | "verify";

const DURATION_OPTIONS = [
  { label: "15 minutes", minutes: 15 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
];

/**
 * "Access Workspace" (docs/15-super-admin.md): reason -> platform MFA ->
 * time-limited session -> visible SUPPORT MODE banner for the duration
 * (rendered by the tenant layout once inside, not here).
 *
 * The MFA step is a real Supabase Auth step-up (supabase.auth.mfa.*, the
 * platform admin's OWN account) run entirely client-side against the
 * browser client -- same pattern as features/security/components/
 * mfa-enrollment.tsx, hand-rolled here rather than reused directly since
 * that component is styled with the tenant app's shadcn primitives and
 * this shell deliberately never imports those (docs/15's "completely
 * separate UI" rule). A successful challengeAndVerify() upgrades the
 * CURRENT session to AAL2 before startImpersonationAction ever runs --
 * the server re-checks that independently rather than trusting this
 * step succeeded.
 */
export function AccessWorkspaceDialog({
  tenantId,
  tenantSlug,
  targetProfileId,
  targetLabel,
}: {
  tenantId: string;
  tenantSlug: string;
  targetProfileId: string;
  targetLabel: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("closed");
  const [reason, setReason] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setStep("closed");
    setReason("");
    setDurationMinutes(30);
    setFactorId(null);
    setQrCode(null);
    setSecret(null);
    setCode("");
    setError(null);
  }

  async function onContinueFromReason() {
    if (!reason.trim()) {
      setError("A reason is required");
      return;
    }
    setError(null);

    const supabase = createClient();
    const { data } = await supabase.auth.mfa.listFactors();
    const verified = data?.totp?.find((f) => f.status === "verified") ?? null;

    if (verified) {
      setFactorId(verified.id);
      setStep("verify");
    } else {
      setStep("enroll");
    }
  }

  async function onStartEnroll() {
    setError(null);
    const supabase = createClient();
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Platform admin (${new Date().toLocaleDateString()})`,
    });

    if (enrollError || !data) {
      setError(enrollError?.message ?? "Could not start two-factor enrollment");
      return;
    }

    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
  }

  function onVerify(e: React.FormEvent) {
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

      const result = await startImpersonationAction(tenantId, targetProfileId, reason, durationMinutes);
      if (result.error) {
        setError(result.error);
        return;
      }

      router.push(`/t/${tenantSlug}`);
    });
  }

  if (step === "closed") {
    return (
      <button
        type="button"
        onClick={() => setStep("reason")}
        className="rounded bg-amber-500/20 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-500/30"
      >
        Access Workspace
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-amber-300">Access Workspace — {targetLabel}</p>
        <button type="button" onClick={reset} className="text-xs text-white/50 hover:text-white/80">
          Cancel
        </button>
      </div>

      {step === "reason" && (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-white/50">Reason (required)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm outline-none focus:border-white/30"
            />
          </div>
          <div>
            <label className="text-xs text-white/50">Session length</label>
            <select
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm outline-none focus:border-white/30"
            >
              {DURATION_OPTIONS.map((opt) => (
                <option key={opt.minutes} value={opt.minutes} className="bg-[#0B1220]">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={onContinueFromReason}
            className="rounded bg-white/20 px-3 py-1.5 text-sm hover:bg-white/30"
          >
            Continue
          </button>
        </div>
      )}

      {step === "enroll" && (
        <div className="space-y-3">
          <p className="text-sm text-white/70">
            Platform administrators must have two-factor authentication enabled before accessing a workspace.
          </p>
          {!qrCode ? (
            <button type="button" onClick={onStartEnroll} className="rounded bg-white/20 px-3 py-1.5 text-sm hover:bg-white/30">
              Set up two-factor authentication
            </button>
          ) : (
            <form onSubmit={onVerify} className="space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- data: URI SVG from Supabase */}
              <img src={qrCode} alt="MFA QR code" className="h-32 w-32" />
              {secret && <p className="break-all text-xs text-white/50">Or enter this key manually: {secret}</p>}
              <div>
                <label className="text-xs text-white/50">6-digit code</label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  required
                  className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm outline-none focus:border-white/30"
                />
              </div>
              <button type="submit" disabled={isPending} className="rounded bg-amber-500/30 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-500/40">
                {isPending ? "Verifying..." : "Verify & Access Workspace"}
              </button>
            </form>
          )}
        </div>
      )}

      {step === "verify" && (
        <form onSubmit={onVerify} className="space-y-3">
          <p className="text-sm text-white/70">Enter the 6-digit code from your authenticator app to continue.</p>
          <div>
            <label className="text-xs text-white/50">6-digit code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              maxLength={6}
              autoFocus
              required
              className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm outline-none focus:border-white/30"
            />
          </div>
          <button type="submit" disabled={isPending} className="rounded bg-amber-500/30 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-500/40">
            {isPending ? "Verifying..." : "Verify & Access Workspace"}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}
    </div>
  );
}

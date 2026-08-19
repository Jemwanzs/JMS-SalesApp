"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { endImpersonationAction } from "@/features/platform-admin/actions/end-impersonation";
import type { ImpersonationBanner as ImpersonationBannerValue } from "@/hooks/tenant-context";

function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "0:00";
  const totalSeconds = Math.floor(msRemaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * "SUPPORT MODE — viewing {Tenant} as Platform Administrator — Ends in
 * {countdown}" (docs/15-super-admin.md, spec §96) — rendered for the
 * entire duration of an active impersonation session, always at the top
 * of the shell, never dismissible except by actually ending the session.
 *
 * The countdown is a UX convenience only: migration 0024's SQL functions
 * independently re-check expires_at on every single request regardless
 * of whether this component ever runs, so a client that never reloads
 * past zero doesn't extend real access by a second — it just shows a
 * stale "0:00" until the next navigation hits the real, server-enforced
 * check and redirects to /no-tenant.
 */
export function ImpersonationBanner({
  tenantId,
  impersonation,
}: {
  tenantId: string;
  impersonation: ImpersonationBannerValue;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [ending, setEnding] = useState(false);

  const expiresAtMs = new Date(impersonation.expiresAt).getTime();

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (expiresAtMs - now <= 0) {
      router.push("/no-tenant");
    }
  }, [now, expiresAtMs, router]);

  async function onEndSession() {
    setEnding(true);
    const result = await endImpersonationAction(impersonation.sessionId, tenantId);
    setEnding(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    router.push("/admin/tenants");
  }

  return (
    <div className="flex items-center justify-between gap-2 bg-amber-500 px-3 py-2 text-xs font-medium text-amber-950">
      <span>
        SUPPORT MODE — viewing as Platform Administrator{impersonation.targetProfileName ? ` (${impersonation.targetProfileName})` : ""} — Ends in{" "}
        {formatCountdown(expiresAtMs - now)}
      </span>
      <button
        type="button"
        onClick={onEndSession}
        disabled={ending}
        className="shrink-0 rounded bg-amber-950/10 px-2 py-1 hover:bg-amber-950/20"
      >
        {ending ? "Ending..." : "End session"}
      </button>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";

import { setTenantWelcomeBannerAction } from "@/features/platform-admin/actions/set-tenant-welcome-banner";

/**
 * Controls the login welcome banner (tenant_settings.show_welcome_
 * banner) -- the first plain on/off toggle in this shell, mirroring
 * TenantAddonPanel's Activate/Deactivate + reason-required shape
 * rather than its multi-status logic, since there's only two states
 * here. Off by default for every tenant except the Platform Owner's
 * own (seeded once, migration 0091) -- a regular Tenant Administrator
 * has no path to this from their own Settings page; this panel is the
 * only place it's ever written from.
 */
export function TenantWelcomeBannerPanel({
  tenantId,
  initialEnabled,
}: {
  tenantId: string;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [formOpen, setFormOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const next = !enabled;
    const formData = new FormData();
    formData.set("reason", reason);
    startTransition(async () => {
      const result = await setTenantWelcomeBannerAction(tenantId, next, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEnabled(next);
      setMessage("Done.");
      setFormOpen(false);
      setReason("");
    });
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <h2 className="mb-3 text-sm font-semibold text-white/70">Login welcome banner</h2>

      <div className="rounded border border-white/10 bg-white/5 p-2">
        <p className="text-xs text-white/50">Show welcome banner</p>
        <p className="mt-0.5 text-sm font-medium">{enabled ? "On" : "Off"}</p>
      </div>

      <p className="mt-3 text-xs text-white/50">
        When on, all users of this tenant see a promotional welcome banner once per login, right after selecting a branch.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          className={
            enabled
              ? "rounded bg-red-500/20 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/30"
              : "rounded bg-emerald-500/20 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/30"
          }
        >
          {enabled ? "Disable" : "Enable"}
        </button>
      </div>

      {formOpen && (
        <form onSubmit={onSubmit} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <label className="text-xs text-white/50">{enabled ? "Reason for disabling" : "Reason for enabling"}</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm outline-none focus:border-white/30"
            />
          </div>
          <button type="submit" disabled={isPending} className="rounded bg-white/20 px-3 py-1.5 text-sm hover:bg-white/30">
            {isPending ? "Saving..." : "Confirm"}
          </button>
        </form>
      )}

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      {message && <p className="mt-3 text-sm text-emerald-300">{message}</p>}
    </div>
  );
}

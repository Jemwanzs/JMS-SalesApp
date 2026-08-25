"use client";

import { useState, useTransition } from "react";

import { setAddonTrialDaysAction } from "@/features/platform-admin/actions/set-addon-trial-days";
import type { AddonKey } from "@/types/database.types";

export function AddonTrialDaysForm({ addonKey, currentDays }: { addonKey: AddonKey; currentDays: number }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [days, setDays] = useState(String(currentDays));
  const [reason, setReason] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setMessage(null);
        const formData = new FormData();
        formData.set("days", days);
        formData.set("reason", reason);
        startTransition(async () => {
          const result = await setAddonTrialDaysAction(addonKey, {}, formData);
          if (result.error) {
            setError(result.error);
            return;
          }
          setMessage("Saved.");
        });
      }}
      className="rounded-lg border border-white/10 bg-white/5 p-4"
    >
      <h2 className="mb-1 text-sm font-semibold text-white/70">Trial availability</h2>
      <p className="mb-3 text-xs text-white/50">
        Free trial length offered when a tenant first enables this module. 0 = no trial, straight to checkout.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-24">
          <label className="text-xs text-white/50">Trial days</label>
          <input
            type="number"
            min={0}
            max={365}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            required
            className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm outline-none focus:border-white/30"
          />
        </div>
        <div className="flex-1">
          <label className="text-xs text-white/50">Reason for change</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm outline-none focus:border-white/30"
          />
        </div>
        <button type="submit" disabled={isPending} className="rounded bg-white/20 px-3 py-1.5 text-sm hover:bg-white/30">
          {isPending ? "Saving..." : "Save"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      {message && <p className="mt-2 text-sm text-emerald-300">{message}</p>}
    </form>
  );
}

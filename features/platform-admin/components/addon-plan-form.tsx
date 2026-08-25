"use client";

import { useState, useTransition } from "react";

import { updateAddonPlanAction } from "@/features/platform-admin/actions/update-addon-plan";
import type { AddonPlanRow } from "@/services/PlatformAdminService";

/**
 * Plain, minimally-styled form matching TenantActionsPanel's own
 * established hand-styled aesthetic for this shell (not the tenant
 * app's shadcn components) -- the first real edit UI for a commercial
 * catalog row in this app (billing_plans has never had one either).
 */
export function AddonPlanForm({ plan }: { plan: AddonPlanRow }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [price, setPrice] = useState(String(plan.price));
  const [durationDays, setDurationDays] = useState(String(plan.durationDays));
  const [discountPercent, setDiscountPercent] = useState(String(plan.discountPercent));
  const [isActive, setIsActive] = useState(plan.isActive);
  const [reason, setReason] = useState("");

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{plan.name}</p>
          <p className="text-xs text-white/50">
            {plan.currency} {plan.price.toFixed(2)} · {plan.durationDays} days
            {plan.discountPercent > 0 ? ` · ${plan.discountPercent}% off` : ""}
            {!plan.isActive ? " · inactive" : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
        >
          {open ? "Close" : "Edit"}
        </button>
      </div>

      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setMessage(null);
            const formData = new FormData();
            formData.set("price", price);
            formData.set("durationDays", durationDays);
            formData.set("discountPercent", discountPercent);
            if (isActive) formData.set("isActive", "on");
            formData.set("reason", reason);
            startTransition(async () => {
              const result = await updateAddonPlanAction(plan.id, {}, formData);
              if (result.error) {
                setError(result.error);
                return;
              }
              setMessage("Saved.");
              setOpen(false);
            });
          }}
          className="mt-3 space-y-2"
        >
          <div className="flex flex-wrap gap-2">
            <div className="w-28">
              <label className="text-xs text-white/50">Price ({plan.currency})</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
                className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm outline-none focus:border-white/30"
              />
            </div>
            <div className="w-24">
              <label className="text-xs text-white/50">Duration (days)</label>
              <input
                type="number"
                min={1}
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
                required
                className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm outline-none focus:border-white/30"
              />
            </div>
            <div className="w-24">
              <label className="text-xs text-white/50">Discount (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={discountPercent}
                onChange={(e) => setDiscountPercent(e.target.value)}
                className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm outline-none focus:border-white/30"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-white/70">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active (visible for tenants to subscribe to)
          </label>
          <div>
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
          {error && <p className="text-sm text-red-300">{error}</p>}
          {message && <p className="text-sm text-emerald-300">{message}</p>}
        </form>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";

import { activateAddonAction } from "@/features/platform-admin/actions/activate-addon";
import { deactivateAddonAction } from "@/features/platform-admin/actions/deactivate-addon";
import { grantAddonCreditAction } from "@/features/platform-admin/actions/grant-addon-credit";
import type { TenantAddonView } from "@/services/PlatformAdminService";
import type { AddonKey } from "@/types/database.types";

type ActionKind = "activate" | "deactivate" | "grantCredit" | null;

/**
 * Per-tenant Inventory add-on state + support-override actions --
 * mirrors TenantActionsPanel's exact shape (plain hand-styled forms,
 * same shell aesthetic), scoped to one addon_key. Global pricing/trial
 * config lives on /admin/addons instead -- this panel only shows THIS
 * tenant's current entitlement and lets a Super Admin force it.
 */
export function TenantAddonPanel({
  tenantId,
  addonKey,
  addon,
  currency,
}: {
  tenantId: string;
  addonKey: AddonKey;
  addon: TenantAddonView | null;
  currency: string;
}) {
  const [open, setOpen] = useState<ActionKind>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function runReasonAction(action: (prev: object, formData: FormData) => Promise<{ error?: string; success?: boolean }>, reason: string) {
    setError(null);
    setMessage(null);
    const formData = new FormData();
    formData.set("reason", reason);
    startTransition(async () => {
      const result = await action({}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage("Done.");
      setOpen(null);
    });
  }

  function runCreditAction(reason: string, amount: string) {
    setError(null);
    setMessage(null);
    const formData = new FormData();
    formData.set("reason", reason);
    formData.set("amount", amount);
    formData.set("currency", currency);
    startTransition(async () => {
      const result = await grantAddonCreditAction(tenantId, addonKey, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage("Credit granted.");
      setOpen(null);
    });
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <h2 className="mb-3 text-sm font-semibold text-white/70">Inventory add-on</h2>

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Status", value: addon?.status ?? "Not enabled" },
          { label: "Plan", value: addon?.planName ?? "—" },
          { label: "Trial ends", value: addon?.trialEnd ? new Date(addon.trialEnd).toLocaleDateString() : "—" },
          { label: "Period ends", value: addon?.currentPeriodEnd ? new Date(addon.currentPeriodEnd).toLocaleDateString() : "—" },
        ].map((item) => (
          <div key={item.label} className="rounded border border-white/10 bg-white/5 p-2">
            <p className="text-xs text-white/50">{item.label}</p>
            <p className="mt-0.5 text-sm font-medium">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {addon?.status !== "ACTIVE" && (
          <button
            type="button"
            onClick={() => setOpen(open === "activate" ? null : "activate")}
            className="rounded bg-emerald-500/20 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/30"
          >
            Activate
          </button>
        )}
        {addon && addon.status !== "SUSPENDED" && addon.status !== "CANCELLED" && (
          <button
            type="button"
            onClick={() => setOpen(open === "deactivate" ? null : "deactivate")}
            className="rounded bg-red-500/20 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/30"
          >
            Deactivate
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(open === "grantCredit" ? null : "grantCredit")}
          className="rounded bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
        >
          Grant Credit
        </button>
      </div>

      {open === "activate" && (
        <ReasonForm
          label="Reason for activation"
          isPending={isPending}
          onSubmit={(reason) => runReasonAction(activateAddonAction.bind(null, tenantId, addonKey), reason)}
        />
      )}
      {open === "deactivate" && (
        <ReasonForm
          label="Reason for deactivation"
          isPending={isPending}
          onSubmit={(reason) => runReasonAction(deactivateAddonAction.bind(null, tenantId, addonKey), reason)}
        />
      )}
      {open === "grantCredit" && (
        <ReasonAmountForm
          label={`Credit amount (${currency})`}
          isPending={isPending}
          onSubmit={(reason, amount) => runCreditAction(reason, amount)}
        />
      )}

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      {message && <p className="mt-3 text-sm text-emerald-300">{message}</p>}
    </div>
  );
}

function ReasonForm({ label, isPending, onSubmit }: { label: string; isPending: boolean; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(reason);
      }}
      className="mt-3 flex flex-wrap items-end gap-2"
    >
      <div className="flex-1">
        <label className="text-xs text-white/50">{label}</label>
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
  );
}

function ReasonAmountForm({
  label,
  isPending,
  onSubmit,
}: {
  label: string;
  isPending: boolean;
  onSubmit: (reason: string, amount: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(reason, amount);
      }}
      className="mt-3 flex flex-wrap items-end gap-2"
    >
      <div className="flex-1">
        <label className="text-xs text-white/50">Reason</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm outline-none focus:border-white/30"
        />
      </div>
      <div className="w-28">
        <label className="text-xs text-white/50">{label}</label>
        <input
          type="number"
          min={0.01}
          step={0.01}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm outline-none focus:border-white/30"
        />
      </div>
      <button type="submit" disabled={isPending} className="rounded bg-white/20 px-3 py-1.5 text-sm hover:bg-white/30">
        {isPending ? "Saving..." : "Confirm"}
      </button>
    </form>
  );
}

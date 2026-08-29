"use client";

import { useState, useTransition } from "react";

import { adjustGracePeriodAction } from "@/features/platform-admin/actions/adjust-grace-period";
import { deactivateTenantAction } from "@/features/platform-admin/actions/deactivate-tenant";
import { extendTrialAction } from "@/features/platform-admin/actions/extend-trial";
import { grantSubscriptionCreditAction } from "@/features/platform-admin/actions/grant-subscription-credit";
import { reactivateTenantAction } from "@/features/platform-admin/actions/reactivate-tenant";
import { suspendTenantAction } from "@/features/platform-admin/actions/suspend-tenant";
import type { SubscriptionStatus, TenantStatus } from "@/types/database.types";

type ActionKind = "suspend" | "deactivate" | "reactivate" | "extendTrial" | "adjustGrace" | "grantCredit" | null;

/**
 * Plain, minimally-styled forms (no shadcn primitives) -- matching the
 * platform-admin shell's own existing dark, hand-styled aesthetic
 * rather than importing the tenant app's design-token-dependent
 * components into a shell that was deliberately built as a completely
 * separate UI (docs/15-super-admin.md).
 */
export function TenantActionsPanel({
  tenantId,
  status,
  subscriptionStatus,
  currency,
  isPlatformOwner,
}: {
  tenantId: string;
  status: TenantStatus;
  subscriptionStatus: SubscriptionStatus | null;
  currency: string;
  /** The platform owner's own tenant -- suspendTenant/deactivateTenant refuse these server-side regardless, but hiding the buttons avoids showing an action that will always error. */
  isPlatformOwner: boolean;
}) {
  const [open, setOpen] = useState<ActionKind>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function runSimpleAction(action: (prev: object, formData: FormData) => Promise<{ error?: string; success?: boolean }>, reason: string) {
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

  function runDaysAction(
    action: (prev: object, formData: FormData) => Promise<{ error?: string; success?: boolean }>,
    reason: string,
    days: string
  ) {
    setError(null);
    setMessage(null);
    const formData = new FormData();
    formData.set("reason", reason);
    formData.set("days", days);
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
      const result = await grantSubscriptionCreditAction(tenantId, {}, formData);
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
      <h2 className="mb-3 text-sm font-semibold text-white/70">Actions</h2>
      {isPlatformOwner && (
        <p className="mb-3 text-xs text-emerald-300">This is the platform owner&apos;s own tenant -- always active, never billing-pushed.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {!isPlatformOwner && (status === "active" || status === "suspended") && (
          <button
            type="button"
            onClick={() => setOpen(open === "suspend" ? null : "suspend")}
            className="rounded bg-red-500/20 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/30"
          >
            Suspend
          </button>
        )}
        {!isPlatformOwner && (status === "active" || status === "suspended") && (
          <button
            type="button"
            onClick={() => setOpen(open === "deactivate" ? null : "deactivate")}
            className="rounded bg-red-900/40 px-3 py-1.5 text-sm text-red-200 hover:bg-red-900/60"
          >
            Deactivate
          </button>
        )}
        {(status === "suspended" || status === "deactivated") && (
          <button
            type="button"
            onClick={() => setOpen(open === "reactivate" ? null : "reactivate")}
            className="rounded bg-emerald-500/20 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/30"
          >
            Reactivate
          </button>
        )}
        {status !== "deactivated" && subscriptionStatus !== "ACTIVE" && subscriptionStatus !== "CANCELLED" && (
          <button
            type="button"
            onClick={() => setOpen(open === "extendTrial" ? null : "extendTrial")}
            className="rounded bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
          >
            Extend Trial
          </button>
        )}
        {status !== "deactivated" && (
          <button
            type="button"
            onClick={() => setOpen(open === "adjustGrace" ? null : "adjustGrace")}
            className="rounded bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
          >
            Adjust Grace Period
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

      {open === "suspend" && (
        <ReasonForm
          label="Reason for suspension"
          isPending={isPending}
          onSubmit={(reason) => runSimpleAction(suspendTenantAction.bind(null, tenantId), reason)}
        />
      )}
      {open === "deactivate" && (
        <ReasonForm
          label="Reason for deactivation"
          isPending={isPending}
          onSubmit={(reason) => runSimpleAction(deactivateTenantAction.bind(null, tenantId), reason)}
        />
      )}
      {open === "reactivate" && (
        <ReasonForm
          label="Reason for reactivation"
          isPending={isPending}
          onSubmit={(reason) => runSimpleAction(reactivateTenantAction.bind(null, tenantId), reason)}
        />
      )}
      {open === "extendTrial" && (
        <ReasonDaysForm
          label="Extend trial by (days)"
          isPending={isPending}
          onSubmit={(reason, days) => runDaysAction(extendTrialAction.bind(null, tenantId), reason, days)}
        />
      )}
      {open === "adjustGrace" && (
        <ReasonDaysForm
          label="Extend grace period by (days)"
          isPending={isPending}
          onSubmit={(reason, days) => runDaysAction(adjustGracePeriodAction.bind(null, tenantId), reason, days)}
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

function ReasonForm({
  label,
  isPending,
  onSubmit,
}: {
  label: string;
  isPending: boolean;
  onSubmit: (reason: string) => void;
}) {
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

function ReasonDaysForm({
  label,
  isPending,
  onSubmit,
}: {
  label: string;
  isPending: boolean;
  onSubmit: (reason: string, days: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("7");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(reason, days);
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
      <div className="w-24">
        <label className="text-xs text-white/50">{label}</label>
        <input
          type="number"
          min={1}
          value={days}
          onChange={(e) => setDays(e.target.value)}
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

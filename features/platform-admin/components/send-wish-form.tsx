"use client";

import { useState, useTransition } from "react";

import { sendAdHocWishAction } from "@/features/platform-admin/actions/send-adhoc-wish";

/**
 * Tenant 360's on-demand anniversary wish -- distinct from the review
 * queue (features/platform-admin/components/anniversary-review-queue.tsx),
 * which only ever shows a tenant already inside the 7-day pre-anniversary
 * scheduling window. This works any time, for any tenant with an
 * anniversary date on file.
 */
export function SendWishForm({ tenantId, hasAnniversaryDate }: { tenantId: string; hasAnniversaryDate: boolean }) {
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (!hasAnniversaryDate) {
    return <p className="text-sm text-white/50">No anniversary date on file for this business yet.</p>;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const formData = new FormData();
    formData.set("message", message);

    startTransition(async () => {
      const result = await sendAdHocWishAction(tenantId, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSent(true);
      setMessage("");
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <div className="flex-1">
        <label className="text-xs text-white/50">Message</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          required
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm outline-none focus:border-white/30"
        />
      </div>
      <button type="submit" disabled={isPending} className="rounded bg-emerald-500/20 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/30">
        {isPending ? "Sending..." : "Send"}
      </button>
      {error && <p className="w-full text-sm text-red-300">{error}</p>}
      {sent && !error && <p className="w-full text-sm text-emerald-300">Wish sent.</p>}
    </form>
  );
}

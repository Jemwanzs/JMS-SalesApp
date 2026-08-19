"use client";

import { useState, useTransition } from "react";

import { sendAnniversaryWishAction, skipAnniversaryWishAction } from "@/features/platform-admin/actions/send-anniversary-wish";
import type { AnniversaryWishView } from "@/services/AnniversaryService";

/**
 * "Review before sending" mode's queue (docs/15-super-admin.md's
 * "Business anniversaries" section) -- a platform admin can edit the
 * generated message before it's marked sent. Real email delivery isn't
 * wired yet (see AnniversaryService's own header comment); "Send" here
 * makes the wish visible to the tenant's own app.
 */
export function AnniversaryReviewQueue({ wishes }: { wishes: AnniversaryWishView[] }) {
  const [items, setItems] = useState(wishes);
  const [drafts, setDrafts] = useState<Record<string, string>>(Object.fromEntries(wishes.map((w) => [w.id, w.message])));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSend(wishId: string) {
    setError(null);
    startTransition(async () => {
      const result = await sendAnniversaryWishAction(wishId, drafts[wishId] ?? "");
      if (result.error) {
        setError(result.error);
        return;
      }
      setItems((prev) => prev.filter((w) => w.id !== wishId));
    });
  }

  function onSkip(wishId: string) {
    setError(null);
    startTransition(async () => {
      const result = await skipAnniversaryWishAction(wishId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setItems((prev) => prev.filter((w) => w.id !== wishId));
    });
  }

  if (items.length === 0) {
    return <p className="text-sm text-white/50">Nothing pending review.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-300">{error}</p>}
      {items.map((w) => (
        <div key={w.id} className="rounded-lg border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between text-sm">
            <p className="font-medium">
              {w.tenantName} — {w.year}
            </p>
            <p className="text-white/50">Scheduled {new Date(`${w.scheduledFor}T00:00:00Z`).toLocaleDateString()}</p>
          </div>
          <textarea
            value={drafts[w.id] ?? ""}
            onChange={(e) => setDrafts((prev) => ({ ...prev, [w.id]: e.target.value }))}
            rows={2}
            className="mt-2 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm outline-none focus:border-white/30"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onSend(w.id)}
              disabled={isPending}
              className="rounded bg-emerald-500/20 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/30"
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => onSkip(w.id)}
              disabled={isPending}
              className="rounded bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
            >
              Skip this year
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

import type { Metadata } from "next";

import { AnniversaryReviewQueue } from "@/features/platform-admin/components/anniversary-review-queue";
import { AnniversaryService } from "@/services/AnniversaryService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const metadata: Metadata = {
  title: "Anniversaries | Platform Admin",
};

/**
 * Phase 7d (docs/15-super-admin.md's "Business anniversaries" section):
 * "Super Admin dashboard surfaces upcoming anniversaries" (the list
 * below) plus the "Review Before Sending" mode's actual review queue.
 * Both read/write through AnniversaryService's service-role paths, same
 * posture as every other platform-admin screen.
 */
export default async function PlatformAnniversariesPage() {
  const service = new AnniversaryService(createServiceRoleClient());
  const [upcoming, pendingReview] = await Promise.all([service.listUpcoming(30), service.listPendingReviews()]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-4 text-xl font-semibold">Anniversaries</h1>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-white/70">Upcoming (next 30 days)</h2>
          <div className="divide-y divide-white/5 rounded-lg border border-white/10">
            {upcoming.length === 0 && <p className="p-4 text-sm text-white/50">No upcoming anniversaries.</p>}
            {upcoming.map((u) => (
              <div key={u.tenantId} className="flex items-center justify-between p-3 text-sm">
                <div>
                  <p className="font-medium">{u.tenantName}</p>
                  <p className="text-xs text-white/50">
                    {u.yearsCount} year{u.yearsCount === 1 ? "" : "s"} · {new Date(`${u.nextOccurrence}T00:00:00Z`).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right text-xs">
                  <p className="text-white/70">{u.daysUntil === 0 ? "Today" : `In ${u.daysUntil} day${u.daysUntil === 1 ? "" : "s"}`}</p>
                  <p className="text-white/40">
                    {u.wishMode === "disabled" ? "Wishes disabled" : u.wishMode === "automatic" ? "Automatic" : "Review before sending"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-white/70">Pending review</h2>
        <AnniversaryReviewQueue wishes={pendingReview} />
      </div>
    </div>
  );
}

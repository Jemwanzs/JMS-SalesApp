/**
 * "48 hours" for a short trial, "180 days" for a long one -- days <= 3
 * reads as hours (more tangible/urgent for a short trial), longer
 * trials stay in days. Shared by the confirm-dialog copy
 * (inventory-module-card.tsx) and the post-success copy
 * (set-inventory-enabled.ts) so a tenant never sees "2-day" before
 * confirming and "48 hours" after.
 */
export function formatTrialLength(days: number): string {
  return days <= 3 ? `${days * 24} hours` : `${days} days`;
}

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Generic per-route loading.tsx fallback -- title bar + N row placeholders,
 * good enough to replace "blank frozen screen" with visible feedback on
 * every dashboard route (none had any loading.tsx before the UX-efficiency
 * pass; Skeleton itself existed but was never actually rendered anywhere).
 * Not pixel-matched per page -- the win here is ANY feedback during the
 * server round-trip, not a precise content-shape match.
 */
export function PageLoadingSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-1 flex-col p-6">
      <Skeleton className="mb-4 h-6 w-40" />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

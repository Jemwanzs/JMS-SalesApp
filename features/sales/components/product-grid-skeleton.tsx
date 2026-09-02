import { Skeleton } from "@/components/ui/skeleton";

/**
 * Suspense fallback for <SalesCaptureBody> on the Capture Sales landing
 * page -- lets the page header (greeting, date, business-day status)
 * paint and stream to the browser immediately instead of waiting on the
 * ranking analytics query behind it (up to 3 sequential `sales`-table
 * scans on a day with no sales yet, purely to compute Gold/Silver/Bronze
 * tier badges -- see SalesCaptureBody's own comment). Shaped roughly
 * like ProductGrid's own search bar + row list so there's no visible
 * layout jump once the real grid streams in.
 */
export function ProductGridSkeleton() {
  return (
    <div className="-mx-6 mt-4 flex flex-1 flex-col">
      <div className="px-4 pb-3">
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
      <div className="divide-y">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-4">
            <Skeleton className="h-12 w-12 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

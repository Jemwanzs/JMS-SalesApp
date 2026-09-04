import Link from "next/link";

import { ProductPhotoThumbnail } from "@/features/products/components/product-photo-viewer";
import type { StockBalanceRow } from "@/services/StockService";

/** Shared between the Stock page's Reconcile tab and the standalone /stock/reconcile route. */
export function ReconciliationQueueList({ tenantSlug, pending }: { tenantSlug: string; pending: StockBalanceRow[] }) {
  if (pending.length === 0) {
    return <p className="text-center text-sm text-muted-foreground">Every tracked product has been counted today.</p>;
  }

  return (
    <div className="divide-y rounded-lg border">
      {pending.map((row) => (
        <Link
          key={row.productId}
          href={`/t/${tenantSlug}/stock/reconcile/${row.productId}`}
          className="flex items-center gap-3 p-3 hover:bg-muted/50"
        >
          <ProductPhotoThumbnail imageUrl={row.imageUrl} productName={row.productName} showName={false} className="h-14 w-14 border" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{row.productName}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              System balance: {row.balance} {row.unitOfMeasure ?? "units"}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}

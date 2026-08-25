import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ProductPhotoThumbnail } from "@/features/products/components/product-photo-viewer";
import type { StockBalanceRow } from "@/services/StockService";

export function StockProductCard({ tenantSlug, row }: { tenantSlug: string; row: StockBalanceRow }) {
  const low = row.lowStockThreshold !== null && row.balance <= row.lowStockThreshold;

  return (
    <Link href={`/t/${tenantSlug}/stock/${row.productId}`} className="flex items-center gap-3 p-3 hover:bg-muted/50">
      <ProductPhotoThumbnail imageUrl={row.imageUrl} productName={row.productName} showName={false} className="h-14 w-14 border" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{row.productName}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {row.balance} {row.unitOfMeasure ?? "units"}
        </p>
      </div>
      {low && (
        <Badge variant="destructive" className="shrink-0">
          Low stock
        </Badge>
      )}
    </Link>
  );
}

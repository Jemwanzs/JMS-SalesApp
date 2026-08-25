import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StockBalanceRow } from "@/services/StockService";

export function LowStockList({ tenantSlug, rows }: { tenantSlug: string; rows: StockBalanceRow[] }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Low stock</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) => (
          <Link
            key={row.productId}
            href={`/t/${tenantSlug}/stock/${row.productId}`}
            className="flex items-center justify-between gap-2 rounded-lg border p-2 hover:bg-muted/50"
          >
            <span className="truncate text-sm font-medium">{row.productName}</span>
            <Badge variant="destructive" className="shrink-0 tabular-nums">
              {row.balance} {row.unitOfMeasure ?? ""}
            </Badge>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

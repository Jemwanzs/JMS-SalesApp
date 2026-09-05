"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { MovementHistoryList } from "@/features/stock/components/movement-history-list";
import { QuickStockEntryDialog } from "@/features/stock/components/quick-stock-entry-dialog";
import type { RecordableMovementType, StockMovementRow } from "@/services/StockService";

const QUICK_ACTIONS: { type: RecordableMovementType; label: string }[] = [
  { type: "opening_stock", label: "Opening stock" },
  { type: "stock_in", label: "Stock in" },
  { type: "stock_out", label: "Stock out" },
  { type: "adjustment_increase", label: "Adjust +" },
  { type: "adjustment_decrease", label: "Adjust −" },
  { type: "damaged", label: "Damaged" },
  { type: "expired", label: "Expired" },
  { type: "lost", label: "Lost/missing" },
];

export function StockProductDetail({
  tenantId,
  tenantSlug,
  productId,
  productName,
  unitOfMeasure,
  balance,
  movements,
  canRecord,
  stockControlMethod,
}: {
  tenantId: string;
  tenantSlug: string;
  productId: string;
  productName: string;
  unitOfMeasure: string | null;
  balance: number;
  movements: StockMovementRow[];
  canRecord: boolean;
  stockControlMethod: "quantity" | "value";
}) {
  const [activeType, setActiveType] = useState<RecordableMovementType | null>(null);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4 text-center">
        <p className="text-xs text-muted-foreground">Current balance</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">
          {balance} <span className="text-base font-normal text-muted-foreground">{unitOfMeasure ?? "units"}</span>
        </p>
      </div>

      {canRecord && (
        <div className="grid grid-cols-2 gap-2">
          {QUICK_ACTIONS.map((action) => (
            <Button key={action.type} variant="outline" onClick={() => setActiveType(action.type)}>
              {action.label}
            </Button>
          ))}
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Movement history</h2>
        <MovementHistoryList movements={movements} unitOfMeasure={unitOfMeasure} />
      </div>

      <QuickStockEntryDialog
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        productId={productId}
        productName={productName}
        unitOfMeasure={unitOfMeasure}
        stockControlMethod={stockControlMethod}
        movementType={activeType}
        onOpenChange={(open) => !open && setActiveType(null)}
      />
    </div>
  );
}

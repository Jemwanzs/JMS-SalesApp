"use client";

import { useState } from "react";
import { toast } from "sonner";

import { CorrectSaleDialog } from "@/features/sales/components/correct-sale-dialog";
import { VoidSaleDialog } from "@/features/sales/components/void-sale-dialog";
import { Badge } from "@/components/ui/badge";
import type { SaleListItem } from "@/services/SalesService";
import type { VoidOrCorrectResult } from "@/types/database.types";

const STATUS_VARIANT: Record<SaleListItem["status"], "default" | "secondary" | "destructive"> = {
  open: "default",
  locked: "secondary",
  corrected: "secondary",
  voided: "destructive",
};

export function SaleHistoryList({
  sales,
  tenantSlug,
  currentUserId,
  canVoid,
  canEditWindow,
  canCorrectHistorical,
}: {
  sales: SaleListItem[];
  tenantSlug: string;
  currentUserId: string;
  canVoid: boolean;
  canEditWindow: boolean;
  canCorrectHistorical: boolean;
}) {
  const [items, setItems] = useState(sales);

  function onResolved(saleId: string, result: VoidOrCorrectResult) {
    if (result.status === "pending_approval") {
      toast("Submitted for approval", {
        description: "This change needs a reviewer's sign-off before it takes effect.",
      });
      return;
    }

    if (result.status === "voided") {
      setItems((prev) => prev.map((s) => (s.id === saleId ? { ...s, status: "voided" } : s)));
      toast.success("Sale voided");
      return;
    }

    if (result.status === "corrected") {
      setItems((prev) => prev.map((s) => (s.id === saleId ? { ...s, status: "corrected" } : s)));
      toast.success("Sale corrected", {
        description: "A replacement sale was recorded with the new amount.",
      });
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">No sales recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="divide-y rounded-lg border">
      {items.map((sale) => {
        const canCorrectThis =
          (canEditWindow && sale.recordedBy === currentUserId) || canCorrectHistorical;

        return (
          <div key={sale.id} className="flex flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{sale.productNameSnapshot}</p>
                <p className="text-xs text-muted-foreground">
                  {sale.saleNumber ?? "—"} ·{" "}
                  {new Date(sale.saleTime).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium tabular-nums">{sale.actualAmount.toFixed(2)}</p>
                <Badge variant={STATUS_VARIANT[sale.status]}>{sale.status}</Badge>
              </div>
            </div>

            {sale.status === "open" && (canVoid || canCorrectThis) && (
              <div className="flex gap-2">
                {canCorrectThis && (
                  <CorrectSaleDialog
                    saleId={sale.id}
                    currentAmount={sale.actualAmount}
                    tenantSlug={tenantSlug}
                    onResolved={(result) => onResolved(sale.id, result)}
                  />
                )}
                {canVoid && (
                  <VoidSaleDialog
                    saleId={sale.id}
                    tenantSlug={tenantSlug}
                    onResolved={(result) => onResolved(sale.id, result)}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { exportSalesHistoryCsvAction } from "@/features/sales/actions/export-sales-history";
import { CorrectSaleDialog } from "@/features/sales/components/correct-sale-dialog";
import { ReverseSaleDialog } from "@/features/sales/components/reverse-sale-dialog";
import { VoidSaleDialog } from "@/features/sales/components/void-sale-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SaleListItem } from "@/services/SalesService";
import type { VoidOrCorrectResult } from "@/types/database.types";

function triggerDownload(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * docs/05's download-security flow -- generation now happens server-side
 * (export-sales-history.ts), so this component's job is just: collect a
 * passcode when the tenant requires one, then hand the resulting CSV
 * string off to the browser.
 */
function ExportCsvButton({
  tenantId,
  filters,
  requiresPasscode,
}: {
  tenantId: string;
  filters: { from?: string; to?: string; q?: string };
  requiresPasscode: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function runExport(enteredPasscode: string | null) {
    setError(null);
    startTransition(async () => {
      const result = await exportSalesHistoryCsvAction(tenantId, filters, enteredPasscode);
      if (result.error) {
        setError(result.error);
        return;
      }
      triggerDownload(result.csv!, result.filename!);
      setDialogOpen(false);
      setPasscode("");
    });
  }

  function onClick() {
    if (requiresPasscode) {
      setDialogOpen(true);
      return;
    }
    runExport(null);
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onClick}>
        {isPending ? "Exporting..." : "Export CSV"}
      </Button>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter download passcode</DialogTitle>
            <DialogDescription>
              This tenant requires a passcode to export sales data.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button disabled={isPending || !passcode} onClick={() => runExport(passcode)}>
              {isPending ? "Verifying..." : "Download"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const STATUS_VARIANT: Record<
  SaleListItem["status"],
  "default" | "secondary" | "destructive"
> = {
  open: "default",
  locked: "secondary",
  corrected: "secondary",
  voided: "destructive",
  reversed: "secondary",
};

export function SaleHistoryList({
  sales,
  tenantId,
  tenantSlug,
  currentUserId,
  canVoid,
  canReverse,
  canEditWindow,
  canCorrectHistorical,
  requiresDownloadPasscode,
  filters,
}: {
  sales: SaleListItem[];
  tenantId: string;
  tenantSlug: string;
  currentUserId: string;
  canVoid: boolean;
  canReverse: boolean;
  canEditWindow: boolean;
  canCorrectHistorical: boolean;
  requiresDownloadPasscode: boolean;
  filters: { from?: string; to?: string; q?: string };
}) {
  const [items, setItems] = useState(sales);

  function onResolved(saleId: string, result: VoidOrCorrectResult) {
    if (result.status === "pending_approval") {
      toast("Submitted for approval", {
        description:
          "This change needs a reviewer's sign-off before it takes effect.",
      });
      return;
    }

    if (result.status === "voided") {
      setItems((prev) =>
        prev.map((s) => (s.id === saleId ? { ...s, status: "voided" } : s)),
      );
      toast.success("Sale voided");
      return;
    }

    if (result.status === "corrected") {
      setItems((prev) =>
        prev.map((s) => (s.id === saleId ? { ...s, status: "corrected" } : s)),
      );
      toast.success("Sale corrected", {
        description: "A replacement sale was recorded with the new amount.",
      });
      return;
    }

    if (result.status === "reversed") {
      setItems((prev) =>
        prev.map((s) => (s.id === saleId ? { ...s, status: "reversed" } : s)),
      );
      toast.success("Sale reversed", {
        description: "An offsetting entry was recorded for the same amount.",
      });
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No sales match these filters.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {items.length} sale{items.length === 1 ? "" : "s"}
        </p>
        <ExportCsvButton tenantId={tenantId} filters={filters} requiresPasscode={requiresDownloadPasscode} />
      </div>
      <div className="divide-y rounded-lg border">
        {items.map((sale) => {
          const canCorrectThis =
            (canEditWindow && sale.recordedBy === currentUserId) ||
            canCorrectHistorical;

          return (
            <div key={sale.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {sale.productNameSnapshot}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {sale.saleNumber ?? "—"} ·{" "}
                    {new Date(sale.saleTime).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium tabular-nums">
                    {sale.actualAmount.toFixed(2)}
                  </p>
                  <Badge variant={STATUS_VARIANT[sale.status]}>
                    {sale.status}
                  </Badge>
                </div>
              </div>

              {sale.status === "open" && (canVoid || canReverse || canCorrectThis) && (
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
                  {canReverse && (
                    <ReverseSaleDialog
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
    </div>
  );
}

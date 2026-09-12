"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { exportSalesHistoryCsvAction } from "@/features/sales/actions/export-sales-history";
import { CorrectSaleDialog } from "@/features/sales/components/correct-sale-dialog";
import { DeleteSaleDialog } from "@/features/sales/components/delete-sale-dialog";
import type { ProductComboboxItem } from "@/features/sales/components/product-combobox";
import { ReverseSaleDialog } from "@/features/sales/components/reverse-sale-dialog";
import { VoidSaleDialog } from "@/features/sales/components/void-sale-dialog";
import { useWindowExpired } from "@/features/sales/lib/use-window-expired";
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
  filters: { from?: string; to?: string; productId?: string };
  requiresPasscode: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("SalesHistory");

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
        {isPending ? t("exporting") : t("exportCsv")}
      </Button>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("enterDownloadPasscode")}</DialogTitle>
            <DialogDescription>
              {t("passcodeDescription")}
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
              {isPending ? t("verifying") : t("download")}
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
  deleted: "destructive",
};

/** Keys into the "SalesHistory" namespace -- see the status Badge's own usage below. */
const STATUS_LABEL_KEY: Record<
  SaleListItem["status"],
  "statusOpen" | "statusLocked" | "statusCorrected" | "statusVoided" | "statusReversed" | "statusDeleted"
> = {
  open: "statusOpen",
  locked: "statusLocked",
  corrected: "statusCorrected",
  voided: "statusVoided",
  reversed: "statusReversed",
  deleted: "statusDeleted",
};

interface EditDeleteWindowConfig {
  editWindowMode: "business_day" | "hours";
  editWindowHours: number;
  deletionEnabled: boolean;
  deleteWindowMinutes: number;
  quantityEnabled: boolean;
  quantityMandatory: boolean;
  todayDate: string;
  yesterdayDate: string;
}

/**
 * One sale row -- its own component (not inline in the list's .map())
 * because it needs useWindowExpired, a hook, and hook-call count must
 * stay stable across renders of the SAME component; a variable-length
 * list of rows can't share one component's hook calls.
 */
function SaleHistoryRow({
  sale,
  tenantSlug,
  currentUserId,
  canVoid,
  canReverse,
  canEditWindow,
  canCorrectHistorical,
  canDelete,
  products,
  config,
  onResolved,
}: {
  sale: SaleListItem;
  tenantSlug: string;
  currentUserId: string;
  canVoid: boolean;
  canReverse: boolean;
  canEditWindow: boolean;
  canCorrectHistorical: boolean;
  canDelete: boolean;
  products: ProductComboboxItem[];
  config: EditDeleteWindowConfig;
  onResolved: (saleId: string, result: VoidOrCorrectResult) => void;
}) {
  const t = useTranslations("SalesHistory");

  const isOwnSale = sale.recordedBy === currentUserId;

  // Business-day mode's real expiry is server-computed (the day
  // closing), not a fixed duration -- only 'hours' mode gets a live
  // client-side countdown; business-day mode just reflects permission
  // state as of the last page load, same as every other flag here.
  const editHoursExpired = useWindowExpired(
    sale.saleTime,
    config.editWindowMode === "hours" ? config.editWindowHours : null
  );
  const selfServeEditAvailable = canEditWindow && isOwnSale && !(config.editWindowMode === "hours" && editHoursExpired);
  const canCorrectThis = selfServeEditAvailable || canCorrectHistorical;

  const deleteWindowActive = config.deletionEnabled && config.deleteWindowMinutes > 0;
  const deleteExpired = useWindowExpired(sale.saleTime, deleteWindowActive ? config.deleteWindowMinutes : null);
  const canDeleteThis = canDelete && isOwnSale && deleteWindowActive && !deleteExpired;

  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
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
        <div className="shrink-0 text-right">
          <p className="text-sm font-medium tabular-nums">
            {sale.actualAmount.toFixed(2)}
          </p>
          <Badge variant={STATUS_VARIANT[sale.status]}>
            {t(STATUS_LABEL_KEY[sale.status])}
          </Badge>
        </div>
      </div>

      {sale.status === "open" && (canVoid || canReverse || canCorrectThis || canDeleteThis) && (
        <div className="flex items-center gap-2">
          {canCorrectThis && (
            <CorrectSaleDialog
              saleId={sale.id}
              currentAmount={sale.actualAmount}
              currentQuantity={sale.quantity}
              currentProductId={sale.productId}
              currentSaleDate={sale.saleDate}
              todayDate={config.todayDate}
              yesterdayDate={config.yesterdayDate}
              products={products}
              quantityEnabled={config.quantityEnabled}
              quantityMandatory={config.quantityMandatory}
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
          {canDeleteThis && (
            <DeleteSaleDialog
              saleId={sale.id}
              tenantSlug={tenantSlug}
              onResolved={(result) => onResolved(sale.id, result)}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function SaleHistoryList({
  sales,
  tenantId,
  tenantSlug,
  currentUserId,
  canVoid,
  canReverse,
  canEditWindow,
  canCorrectHistorical,
  canDelete,
  products,
  quantityEnabled,
  quantityMandatory,
  todayDate,
  yesterdayDate,
  editWindowMode,
  editWindowHours,
  deletionEnabled,
  deleteWindowMinutes,
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
  canDelete: boolean;
  products: ProductComboboxItem[];
  quantityEnabled: boolean;
  quantityMandatory: boolean;
  todayDate: string;
  yesterdayDate: string;
  editWindowMode: "business_day" | "hours";
  editWindowHours: number;
  deletionEnabled: boolean;
  deleteWindowMinutes: number;
  requiresDownloadPasscode: boolean;
  filters: { from?: string; to?: string; productId?: string };
}) {
  const [items, setItems] = useState(sales);
  const t = useTranslations("SalesHistory");

  // `items` starts as a local copy of `sales` so void/correct can update a
  // row optimistically without waiting on a round trip -- but that means
  // it goes stale the moment the SERVER sends a genuinely new `sales`
  // array (changing the date/product filter, which re-renders this whole
  // page server-side): useState's initializer only runs once, so without
  // this the list kept showing whatever was on screen when the component
  // first mounted, "No sales match" included, even after a filter change
  // brought back real rows. Resyncing on every new `sales` reference is
  // correct here since a fresh filter result should always win over an
  // in-flight optimistic edit.
  useEffect(() => {
    setItems(sales);
  }, [sales]);

  function onResolved(saleId: string, result: VoidOrCorrectResult) {
    if (result.status === "pending_approval") {
      toast(t("submittedForApproval"), {
        description: t("needsReviewerSignoff"),
      });
      return;
    }

    if (result.status === "voided") {
      setItems((prev) =>
        prev.map((s) => (s.id === saleId ? { ...s, status: "voided" } : s)),
      );
      toast.success(t("saleVoided"));
      return;
    }

    if (result.status === "corrected") {
      setItems((prev) =>
        prev.map((s) => (s.id === saleId ? { ...s, status: "corrected" } : s)),
      );
      toast.success(t("saleCorrected"), {
        description: t("replacementRecorded"),
      });
      return;
    }

    if (result.status === "reversed") {
      setItems((prev) =>
        prev.map((s) => (s.id === saleId ? { ...s, status: "reversed" } : s)),
      );
      toast.success(t("saleReversed"), {
        description: t("offsettingRecorded"),
      });
      return;
    }

    if (result.status === "deleted") {
      // A deleted sale genuinely disappears from Sales History (unlike
      // void/correct/reverse, which stay visible with a status badge) --
      // see SalesService.listRecent's own .neq("status","deleted").
      setItems((prev) => prev.filter((s) => s.id !== saleId));
      toast.success(t("saleDeleted"), {
        description: t("stockAndReportsRestored"),
      });
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {t("noSalesMatch")}
        </p>
      </div>
    );
  }

  const config: EditDeleteWindowConfig = {
    editWindowMode,
    editWindowHours,
    deletionEnabled,
    deleteWindowMinutes,
    quantityEnabled,
    quantityMandatory,
    todayDate,
    yesterdayDate,
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {t("saleCount", { count: items.length })}
        </p>
        <ExportCsvButton tenantId={tenantId} filters={filters} requiresPasscode={requiresDownloadPasscode} />
      </div>
      <div className="divide-y rounded-lg border">
        {items.map((sale) => (
          <SaleHistoryRow
            key={sale.id}
            sale={sale}
            tenantSlug={tenantSlug}
            currentUserId={currentUserId}
            canVoid={canVoid}
            canReverse={canReverse}
            canEditWindow={canEditWindow}
            canCorrectHistorical={canCorrectHistorical}
            canDelete={canDelete}
            products={products}
            config={config}
            onResolved={onResolved}
          />
        ))}
      </div>
    </div>
  );
}

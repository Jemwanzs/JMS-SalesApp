"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { getDailySalesReportAction, type DailySalesReportData } from "@/features/sales/actions/get-daily-sales-report";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildDailySalesReportPdf } from "@/lib/utils/generate-daily-report-pdf";

function formatReportDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Product Enhancements #7: a compact "Daily Report" trigger placed next
 * to Sales History's date filters. Opens a mobile-fit preview first
 * (this dialog's own content, styled to match the spec's Header/
 * Content/Footer layout) with Share and Download actions -- both build
 * the same jsPDF document from the already-fetched data, so there's no
 * second round trip between preview and download.
 */
export function DailyReportDialog({ tenantId, todayDate }: { tenantId: string; todayDate: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DailySalesReportData | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isExporting, startExporting] = useTransition();

  function onOpen() {
    setOpen(true);
    if (data) return;
    startLoading(async () => {
      try {
        const result = await getDailySalesReportAction(tenantId, todayDate);
        setData(result);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load the daily report");
        setOpen(false);
      }
    });
  }

  function download() {
    if (!data) return;
    startExporting(async () => {
      const doc = await buildDailySalesReportPdf(data);
      doc.save(`Daily-Sales-${data.reportDate}.pdf`);
    });
  }

  function share() {
    if (!data) return;
    startExporting(async () => {
      const doc = await buildDailySalesReportPdf(data);
      const blob = doc.output("blob") as Blob;
      const file = new File([blob], `Daily-Sales-${data.reportDate}.pdf`, { type: "application/pdf" });

      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `Daily Sales — ${data.tenantName}` });
          return;
        } catch {
          // User cancelled the share sheet, or it failed -- fall through
          // to a plain download so the action still does something.
        }
      }
      doc.save(`Daily-Sales-${data.reportDate}.pdf`);
    });
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={onOpen}>
        Daily Report
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Daily Sales Summary</DialogTitle>
            <DialogDescription>Preview for {formatReportDate(todayDate)}</DialogDescription>
          </DialogHeader>

          {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>}

          {data && !isLoading && (
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-base font-semibold">{data.tenantName}</p>
                {data.adminEmail && <p className="text-xs text-muted-foreground">Admin: {data.adminEmail}</p>}
                <p className="text-xs text-muted-foreground">Report Date: {formatReportDate(data.reportDate)}</p>
              </div>

              <div className="border-t" />

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total Sales</span>
                <span className="font-semibold tabular-nums">
                  {data.currency} {data.totalSalesAmount.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Transactions</span>
                <span className="font-medium tabular-nums">{data.transactionCount}</span>
              </div>

              {data.products.length > 0 ? (
                <div className="divide-y rounded-lg border">
                  {data.products.map((p) => (
                    <div key={p.name} className="flex items-center justify-between gap-2 p-2 text-xs">
                      <span className="min-w-0 truncate">{p.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {p.quantity !== null ? `${p.quantity} · ` : ""}
                        {data.currency} {p.amount.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No sales recorded for this date.</p>
              )}

              <div className="border-t" />

              <div className="flex items-center justify-between">
                <span className="font-semibold">Daily Total</span>
                <span className="font-semibold tabular-nums">
                  {data.currency} {data.totalSalesAmount.toFixed(2)}
                </span>
              </div>

              <p className="text-[11px] text-muted-foreground">
                This is a system-generated report. Generated on {new Date(data.generatedAt).toLocaleString()}.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" disabled={!data || isExporting} onClick={share} className="flex-1">
              Share / Save Poster
            </Button>
            <Button type="button" disabled={!data || isExporting} onClick={download} className="flex-1">
              {isExporting ? "Preparing…" : "Download PDF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

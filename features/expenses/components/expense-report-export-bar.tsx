"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { exportExpensesCsvAction, type ExpensesExportFilters } from "@/features/expenses/actions/export-expenses-csv";
import { exportExpensesExcelAction } from "@/features/expenses/actions/export-expenses-excel";
import { getExpenseReportAction } from "@/features/expenses/actions/get-expense-report";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { buildExpenseReportPdf } from "@/lib/utils/generate-expense-report-pdf";
import type { ExpenseBreakdownDimension } from "@/services/ExpenseService";

function triggerDownload(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Decodes the base64 payload exportExpensesExcelAction returns (a real binary .xlsx can't cross the server-action boundary any other way) back into bytes for the same download-link trick triggerDownload uses. */
function triggerDownloadBase64(base64: string, filename: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * CSV + PDF + Excel export for the selected range/dimension -- same
 * passcode-gated flow ExportCsvButton (Sales History) already uses for
 * CSV, now shared by Excel too since both cross the same
 * require_download_passcode gate; PDF uses the same dynamic-jsPDF-import
 * pattern DailyReportDialog uses for Sales. One flexible export, not
 * per-report-type buttons.
 */
export function ExpenseReportExportBar({
  tenantId,
  filters,
  dimension,
  requiresPasscode,
}: {
  tenantId: string;
  filters: ExpensesExportFilters;
  dimension: ExpenseBreakdownDimension;
  requiresPasscode: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingFormat, setPendingFormat] = useState<"csv" | "excel" | null>(null);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function runCsvExport(enteredPasscode: string | null) {
    setError(null);
    startTransition(async () => {
      const result = await exportExpensesCsvAction(tenantId, filters, enteredPasscode);
      if (result.error) {
        setError(result.error);
        return;
      }
      triggerDownload(result.csv!, result.filename!);
      setDialogOpen(false);
      setPasscode("");
    });
  }

  function runExcelExport(enteredPasscode: string | null) {
    setError(null);
    startTransition(async () => {
      const result = await exportExpensesExcelAction(tenantId, filters, dimension, enteredPasscode);
      if (result.error) {
        setError(result.error);
        return;
      }
      triggerDownloadBase64(
        result.excelBase64!,
        result.filename!,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      setDialogOpen(false);
      setPasscode("");
    });
  }

  function runPendingExport(enteredPasscode: string | null) {
    if (pendingFormat === "excel") {
      runExcelExport(enteredPasscode);
    } else {
      runCsvExport(enteredPasscode);
    }
  }

  function onCsvClick() {
    if (requiresPasscode) {
      setPendingFormat("csv");
      setDialogOpen(true);
      return;
    }
    runCsvExport(null);
  }

  function onExcelClick() {
    if (requiresPasscode) {
      setPendingFormat("excel");
      setDialogOpen(true);
      return;
    }
    runExcelExport(null);
  }

  function onPdfClick() {
    startTransition(async () => {
      try {
        const report = await getExpenseReportAction(tenantId, { from: filters.from ?? "", to: filters.to ?? "", locationId: filters.locationId }, dimension);
        const doc = await buildExpenseReportPdf(report);
        doc.save(`Expenses-${report.fromDate}-to-${report.toDate}.pdf`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not generate the report");
      }
    });
  }

  return (
    <>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onCsvClick} className="flex-1">
          {isPending ? "Working..." : "Export CSV"}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onExcelClick} className="flex-1">
          {isPending ? "Working..." : "Export Excel"}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onPdfClick} className="flex-1">
          {isPending ? "Working..." : "Download PDF"}
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter download passcode</DialogTitle>
            <DialogDescription>This tenant requires a passcode to export expense data.</DialogDescription>
          </DialogHeader>
          <Input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoFocus />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button disabled={isPending || !passcode} onClick={() => runPendingExport(passcode)}>
              {isPending ? "Verifying..." : "Download"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

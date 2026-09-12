"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { exportExpensesCsvAction, type ExpensesExportFilters } from "@/features/expenses/actions/export-expenses-csv";
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

/**
 * CSV + PDF export for the selected range/dimension -- same passcode-
 * gated flow ExportCsvButton (Sales History) already uses for CSV;
 * PDF uses the same dynamic-jsPDF-import pattern DailyReportDialog uses
 * for Sales. One flexible export, not per-report-type buttons.
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

  function onCsvClick() {
    if (requiresPasscode) {
      setDialogOpen(true);
      return;
    }
    runCsvExport(null);
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
            <Button disabled={isPending || !passcode} onClick={() => runCsvExport(passcode)}>
              {isPending ? "Verifying..." : "Download"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

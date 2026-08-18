"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { confirmImportAction } from "@/features/imports/actions/confirm-import";
import { ImportRowResolveDialog } from "@/features/imports/components/import-row-resolve-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ImportRowView, ImportSummary } from "@/services/ImportService";

function cell(value: unknown): string {
  if (value == null) return "—";
  const s = String(value);
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})T00:00:00/);
  return isoMatch ? isoMatch[1] : s;
}

export function ImportDetail({
  tenantId,
  tenantSlug,
  importSummary,
  rows,
}: {
  tenantId: string;
  tenantSlug: string;
  importSummary: ImportSummary;
  rows: ImportRowView[];
}) {
  const [items, setItems] = useState(rows);
  const [confirmed, setConfirmed] = useState<{ imported: number; skipped: number } | null>(null);
  const [isPending, startTransition] = useTransition();

  const validCount = items.filter((r) => r.status === "valid" || r.status === "imported").length;
  const invalidCount = items.filter((r) => r.status === "invalid").length;
  const alreadyImported = items.some((r) => r.status === "imported");
  const canConfirm = importSummary.status !== "completed" && !alreadyImported && validCount > 0;

  function onConfirm() {
    startTransition(async () => {
      const result = await confirmImportAction(tenantId, tenantSlug, importSummary.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setConfirmed({ imported: result.imported ?? 0, skipped: result.skipped ?? 0 });
      toast.success(`Imported ${result.imported} sales`);
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
        <p className="text-sm">
          <span className="font-semibold">{items.length}</span> rows uploaded
        </p>
        <Badge>{validCount} valid</Badge>
        {invalidCount > 0 && <Badge variant="destructive">{invalidCount} require attention</Badge>}
        {confirmed && <Badge variant="default">{confirmed.imported} imported</Badge>}
        <div className="ml-auto">
          {canConfirm && (
            <Button onClick={onConfirm} disabled={isPending}>
              {isPending ? "Importing..." : "Confirm Import"}
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Row</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Details</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.rowNumber}</TableCell>
                <TableCell>{cell(row.rawData.saleDate)}</TableCell>
                <TableCell>{cell(row.rawData.productName) !== "—" ? cell(row.rawData.productName) : cell(row.rawData.productCode)}</TableCell>
                <TableCell>{cell(row.rawData.amount)}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      row.status === "invalid" ? "destructive" : row.status === "valid" ? "default" : "secondary"
                    }
                  >
                    {row.status}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-xs text-xs text-destructive">
                  {row.errors?.join("; ") ?? ""}
                </TableCell>
                <TableCell>
                  {row.status === "invalid" && (
                    <ImportRowResolveDialog
                      tenantId={tenantId}
                      tenantSlug={tenantSlug}
                      importId={importSummary.id}
                      row={row}
                      onResolved={() => {
                        setItems((prev) =>
                          prev.map((r) => (r.id === row.id ? { ...r, status: "valid", errors: null } : r))
                        );
                      }}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

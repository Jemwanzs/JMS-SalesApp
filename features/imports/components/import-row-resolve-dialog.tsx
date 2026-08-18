"use client";

import { useState, useTransition } from "react";

import { resolveImportRowAction } from "@/features/imports/actions/resolve-import-row";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ImportRowView } from "@/services/ImportService";

const FIELDS: { key: string; label: string }[] = [
  { key: "saleDate", label: "Sale Date" },
  { key: "saleTime", label: "Sale Time" },
  { key: "productName", label: "Product Name" },
  { key: "productCode", label: "Product Code" },
  { key: "amount", label: "Amount" },
  { key: "quantity", label: "Quantity" },
  { key: "salesPerson", label: "Sales Person" },
  { key: "location", label: "Location" },
  { key: "existingReference", label: "Existing Reference" },
  { key: "notes", label: "Notes" },
];

/** Cell values may arrive as ISO date strings (exceljs date cells) -- trim to a friendlier edit-field default. */
function toDisplayValue(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})T00:00:00/);
  return isoMatch ? isoMatch[1] : s;
}

export function ImportRowResolveDialog({
  tenantId,
  tenantSlug,
  importId,
  row,
  onResolved,
}: {
  tenantId: string;
  tenantSlug: string;
  importId: string;
  row: ImportRowView;
  onResolved: (result: { valid: boolean; errors?: string[] }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, toDisplayValue(row.rawData[f.key])]))
  );
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await resolveImportRowAction(tenantId, tenantSlug, importId, row.id, values);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (!result.valid) {
        setError(result.errors?.join("; ") ?? "Still has errors");
        return;
      }
      onResolved({ valid: true, errors: result.errors });
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" size="sm" variant="outline" />}>
        Fix row {row.rowNumber}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fix row {row.rowNumber}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3">
          {FIELDS.map((field) => (
            <div key={field.key} className="space-y-1">
              <Label htmlFor={`row-${row.id}-${field.key}`} className="text-xs">
                {field.label}
              </Label>
              <Input
                id={`row-${row.id}-${field.key}`}
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              />
            </div>
          ))}
          {error && <p className="col-span-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="col-span-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Checking..." : "Save & Re-validate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

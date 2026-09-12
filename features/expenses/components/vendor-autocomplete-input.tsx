"use client";

import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";

/**
 * Free-text vendor field with inline (non-floating) suggestions drawn
 * from the tenant's own past distinct vendor names -- not a catalog
 * table (the spec doesn't ask for vendor admin CRUD the way it does for
 * categories/items/payment methods), so any value typed here is
 * accepted, suggestions are purely a convenience. Same inline-expansion
 * shape as the comboboxes elsewhere in this dialog, for the same
 * `contain: layout` reason (see ExpenseItemCombobox's header comment).
 */
export function VendorAutocompleteInput({
  value,
  onChange,
  knownVendors,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  knownVendors: string[];
  id?: string;
}) {
  const [focused, setFocused] = useState(false);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    const pool = q ? knownVendors.filter((v) => v.toLowerCase().includes(q) && v.toLowerCase() !== q) : knownVendors;
    return pool.slice(0, 6);
  }, [knownVendors, value]);

  return (
    <div className="space-y-2">
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="e.g. Kenya Power"
      />
      {focused && suggestions.length > 0 && (
        <div className="divide-y rounded-lg border bg-popover text-popover-foreground shadow-xs">
          {suggestions.map((vendor) => (
            <button
              key={vendor}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(vendor);
                setFocused(false);
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
            >
              {vendor}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

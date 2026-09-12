"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Input } from "@/components/ui/input";

export interface ProductComboboxItem {
  id: string;
  name: string;
  expectedPrice: number | null;
  tracksInventory: boolean;
}

/**
 * Correct Sale's product field -- a searchable, select-only dropdown
 * (type to filter, tap a row to select, no free-text entry). Names
 * only, no product images, per the Sales Record Correction & Deletion
 * spec. Callers exclude the tenant's system "Others" product from
 * `items` before passing them in -- correcting a sale into free-text
 * has no mechanism today, so it's out of scope here.
 *
 * Deliberately renders the search+list INLINE (expanding the trigger
 * downward in normal document flow) rather than as a floating/portaled
 * Popover -- the first version used components/ui/popover.tsx's
 * anchor-based Popover, and that broke inside a Dialog in two separate,
 * confirmed ways: the Dialog's own z-50 backdrop could paint over it
 * (fixed by bumping Popover's z-index), and -- the deeper issue --
 * #app-shell's `contain: layout` (app/(tenant)/t/[tenantSlug]/layout.tsx,
 * needed so a centered Dialog/Sheet stays within the mobile column
 * rather than the full browser window) makes it the containing block
 * for fixed/absolute descendants too, which Base UI's floating-ui-based
 * Positioner doesn't correctly re-anchor to when the page had been
 * scrolled before the dialog opened -- confirmed live: the popup's
 * computed position landed at `top: 1401px` in an 844px-tall viewport,
 * entirely below the fold with the page scroll-locked, so it was
 * simply unreachable. An inline expansion uses zero absolute/fixed
 * positioning, so there's no anchor math to get wrong -- it just pushes
 * whatever's below it (Reason, Save) further down within the dialog's
 * own already-scrollable body (DialogContent's max-h-[85dvh]
 * overflow-y-auto), exactly like any other field growing taller would.
 */
export function ProductCombobox({
  items,
  value,
  onChange,
  id,
}: {
  items: ProductComboboxItem[];
  value: string;
  onChange: (item: ProductComboboxItem) => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = items.find((i) => i.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q));
  }, [items, query]);

  function select(item: ProductComboboxItem) {
    onChange(item);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="space-y-2">
      <button
        id={id}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className={`truncate ${selected ? "" : "text-muted-foreground"}`}>
          {selected?.name ?? "Select product"}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="rounded-lg border bg-popover text-popover-foreground shadow-xs">
          <div className="p-2">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products"
            />
          </div>
          <div className="max-h-48 divide-y overflow-y-auto border-t">
            {filtered.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">No matching products</p>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => select(item)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="truncate">{item.name}</span>
                  {item.id === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Input } from "@/components/ui/input";
import type { ExpenseItem } from "@/services/ExpenseItemService";

/**
 * Replaces the plain native <select> for picking an Expense Item: tap
 * to open, type to filter, tap a row to select -- select-only, no
 * free-text entry (the underlying value only ever changes via
 * `select()` below, never a typed value).
 *
 * Renders the search+list INLINE (expanding the trigger downward in
 * normal document flow) rather than as a floating/portaled Popover --
 * the original version used components/ui/popover.tsx's anchor-based
 * Popover, and the sibling ProductCombobox (features/sales/components/
 * product-combobox.tsx, same shape, same Popover) turned out to break
 * inside a Dialog in two confirmed ways: the Dialog's own z-50 backdrop
 * could paint over it, and -- the deeper issue -- #app-shell's
 * `contain: layout` (needed so a centered Dialog/Sheet stays within the
 * mobile column rather than the full browser window) makes it the
 * containing block for fixed/absolute descendants too, which Base UI's
 * floating-ui-based Positioner doesn't correctly re-anchor to when the
 * page had been scrolled before the dialog opened -- confirmed live on
 * ProductCombobox: the popup's computed position landed hundreds of
 * pixels below the visible viewport, simply unreachable. This
 * component sits inside record-expense-dialog.tsx, the exact same
 * "combobox inside a Dialog" shape, so it gets the identical fix
 * pre-emptively rather than waiting for its own bug report. An inline
 * expansion uses zero absolute/fixed positioning, so there's no anchor
 * math to get wrong -- it just pushes whatever's below it further down
 * within the dialog's own already-scrollable body.
 */
export function ExpenseItemCombobox({
  items,
  value,
  onChange,
  id,
}: {
  items: ExpenseItem[];
  value: string;
  onChange: (id: string) => void;
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

  function select(item: ExpenseItem) {
    onChange(item.id);
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
          {selected?.name ?? "Select expense item"}
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
              placeholder="Search expense items"
            />
          </div>
          <div className="max-h-48 divide-y overflow-y-auto border-t">
            {filtered.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">No matching expense items</p>
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

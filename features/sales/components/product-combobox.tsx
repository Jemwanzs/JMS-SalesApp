"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Popover, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

export interface ProductComboboxItem {
  id: string;
  name: string;
  expectedPrice: number | null;
  tracksInventory: boolean;
}

/**
 * Correct Sale's product field -- a searchable, select-only dropdown
 * (type to filter, tap a row to select, no free-text entry), adapted
 * directly from features/expenses/components/expense-item-combobox.tsx's
 * same trigger-button + anchor-based Popover shape. Names only, no
 * product images, per the Sales Record Correction & Deletion spec.
 * Callers exclude the tenant's system "Others" product from `items`
 * before passing them in -- correcting a sale into free-text has no
 * mechanism today, so it's out of scope here.
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
  const triggerRef = useRef<HTMLButtonElement>(null);
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
    <>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className={`truncate ${selected ? "" : "text-muted-foreground"}`}>
          {selected?.name ?? "Select product"}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {triggerRef.current && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverContent
            anchor={triggerRef.current}
            showArrow={false}
            className="w-[min(20rem,calc(100vw-3rem))] p-0"
          >
            <div className="p-2">
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products"
              />
            </div>
            <div className="max-h-56 divide-y overflow-y-auto border-t">
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
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}

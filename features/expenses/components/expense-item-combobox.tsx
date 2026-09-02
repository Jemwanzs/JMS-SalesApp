"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Popover, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import type { ExpenseItem } from "@/services/ExpenseItemService";

/**
 * Replaces the plain native <select> for picking an Expense Item: tap
 * to open, type to filter, tap a row to select -- select-only, no
 * free-text entry (the underlying value only ever changes via
 * `select()` below, never a typed value). Reuses components/ui/
 * popover.tsx's external-`anchor` API (built for the Guided Onboarding
 * Tour's "point at an arbitrary element" case) rather than a
 * Trigger-owned popover, since that's the only mode this shared
 * primitive supports -- see that file's own header comment.
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
  const triggerRef = useRef<HTMLButtonElement>(null);
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
    <>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className={`truncate ${selected ? "" : "text-muted-foreground"}`}>
          {selected?.name ?? "Select expense item"}
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
                placeholder="Search expense items"
              />
            </div>
            <div className="max-h-56 divide-y overflow-y-auto border-t">
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
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Input } from "@/components/ui/input";
import type { ExpenseCategory } from "@/services/ExpenseCategoryService";

/**
 * Select-only searchable dropdown for picking an Expense Category,
 * structurally identical to ExpenseItemCombobox -- same inline-expansion
 * mechanics for the same reason (see that file's own header comment on
 * the `contain: layout` + Base UI Positioner bug this avoids inside a
 * Dialog).
 */
export function ExpenseCategoryCombobox({
  categories,
  value,
  onChange,
  id,
}: {
  categories: ExpenseCategory[];
  value: string;
  onChange: (id: string) => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = categories.find((c) => c.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, query]);

  function select(category: ExpenseCategory) {
    onChange(category.id);
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
          {selected?.name ?? "Select category"}
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
              placeholder="Search categories"
            />
          </div>
          <div className="max-h-48 divide-y overflow-y-auto border-t">
            {filtered.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">No matching categories</p>
            ) : (
              filtered.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => select(category)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="truncate">{category.name}</span>
                  {category.id === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

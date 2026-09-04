"use client";

import { useMemo, useState } from "react";

import { MOVEMENT_LABEL } from "@/features/stock/components/movement-history-list";
import { Input } from "@/components/ui/input";
import type { StockHistoryEntry } from "@/services/StockService";

function formatDateTime(date: string, createdAt: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const time = new Date(createdAt);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/**
 * Tenant-wide, filterable feed (Stock module spec's "History" tab) --
 * every stock-changing event across every tracked product, newest
 * first. Filtering is client-side over the already-fetched window
 * (StockService.listHistory's own `limit`) -- consistent with this
 * codebase's existing "modest volume, avoid a second round trip"
 * reasoning for stock data (see stock_balances' own header comment).
 */
export function StockHistoryList({ entries }: { entries: StockHistoryEntry[] }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const types = useMemo(() => [...new Set(entries.map((e) => e.movementType))], [entries]);

  const filtered = entries.filter((e) => {
    if (typeFilter !== "all" && e.movementType !== typeFilter) return false;
    if (search && !e.productName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product" className="flex-1" />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border bg-background px-2 text-sm"
        >
          <option value="all">All types</option>
          {types.map((type) => (
            <option key={type} value={type}>
              {MOVEMENT_LABEL[type] ?? type}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">No stock movements match.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {filtered.map((entry) => {
            const positive = entry.quantity > 0;
            return (
              <div key={entry.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{entry.productName}</p>
                  <p className="text-xs text-muted-foreground">
                    {MOVEMENT_LABEL[entry.movementType] ?? entry.movementType} · {formatDateTime(entry.occurredOn, entry.createdAt)}
                    {entry.reason ? ` · ${entry.reason}` : ""}
                  </p>
                </div>
                <p className={`shrink-0 text-sm font-medium tabular-nums ${positive ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                  {positive ? "+" : ""}
                  {entry.quantity} {entry.unitOfMeasure ?? ""}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

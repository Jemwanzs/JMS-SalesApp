"use client";

import { useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { StockProductCard } from "@/features/stock/components/stock-product-card";
import type { StockBalanceRow } from "@/services/StockService";

/** Fast product search (spec's own phrase) -- same simple filter-input pattern ProductManagementList already uses, not a shared component, since this list's data shape (balance + UOM, not price/status) is different from the plain product catalog list. */
export function StockDashboardList({ tenantSlug, balances }: { tenantSlug: string; balances: StockBalanceRow[] }) {
  const [search, setSearch] = useState("");
  const filtered = balances.filter((b) => b.productName.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products" className="pl-9" />
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          {balances.length === 0 ? "No products are tracked in Inventory yet." : "No products match your search."}
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {filtered.map((row) => (
            <StockProductCard key={row.productId} tenantSlug={tenantSlug} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

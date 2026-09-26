import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface BranchComparisonRow {
  locationId: string;
  locationName: string;
  sales?: number;
  expenses?: number;
  stock?: number;
  orders?: number;
}

/**
 * Only rendered in "All Branches" mode (page.tsx gates this) -- one row
 * per active branch, same date range applied to every column. Columns
 * are dynamic (only whichever domains are actually shown as tabs for
 * this tenant) rather than a fixed four, so a tenant with Inventory
 * disabled doesn't get a permanently-empty Stock column. Horizontally-
 * scrollable rather than a fixed-width table -- mobile-first per the
 * spec's own "no horizontal page overflow" rule: the SCROLL is
 * contained to this card, the page itself never overflows.
 */
export function BranchComparisonTable({
  rows,
  columns,
}: {
  rows: BranchComparisonRow[];
  columns: { key: "sales" | "expenses" | "stock" | "orders"; label: string }[];
}) {
  if (rows.length === 0 || columns.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branch Comparison</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Branch</th>
              {columns.map((c) => (
                <th key={c.key} className="py-2 pr-4 text-right font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.locationId} className="border-b last:border-0">
                <td className="py-2 pr-4 font-medium">{row.locationName}</td>
                {columns.map((c) => (
                  <td key={c.key} className="py-2 pr-4 text-right tabular-nums">
                    {(row[c.key] ?? 0).toFixed(2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

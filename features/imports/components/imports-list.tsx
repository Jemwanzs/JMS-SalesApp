import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { ImportSummary } from "@/services/ImportService";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  uploaded: "secondary",
  validating: "secondary",
  validated: "default",
  importing: "default",
  completed: "default",
  failed: "destructive",
};

const TYPE_LABEL: Record<string, string> = {
  sales_history: "Historical sales",
  products: "Products",
};

export function ImportsList({ imports, tenantSlug }: { imports: ImportSummary[]; tenantSlug: string }) {
  if (imports.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">No imports yet.</p>
      </div>
    );
  }

  return (
    <div className="divide-y rounded-lg border">
      {imports.map((imp) => (
        <Link
          key={imp.id}
          href={`/t/${tenantSlug}/imports/${imp.id}`}
          className="flex items-center justify-between gap-3 p-4 hover:bg-muted"
        >
          <div>
            <p className="text-sm font-medium">{imp.fileName}</p>
            <p className="text-xs text-muted-foreground">
              {TYPE_LABEL[imp.type] ?? imp.type} · {imp.totalRows} rows · {imp.validRows} valid ·{" "}
              {imp.errorRows} need attention
              {imp.importedRows > 0 ? ` · ${imp.importedRows} imported` : ""}
            </p>
            <p className="text-xs text-muted-foreground">{new Date(imp.createdAt).toLocaleString()}</p>
          </div>
          <Badge variant={STATUS_VARIANT[imp.status] ?? "secondary"}>{imp.status}</Badge>
        </Link>
      ))}
    </div>
  );
}

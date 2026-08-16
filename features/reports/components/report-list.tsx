import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DailyReportPayload } from "@/services/ReportService";

/**
 * Daily reports only for now (weekly/monthly/custom are later Phase 3
 * increments, see ReportService). Each report's payload is a frozen
 * snapshot computed at generation time, not re-derived on render.
 */
export function ReportList({
  reports,
}: {
  reports: Array<{
    id: string;
    reportType: string;
    periodStart: string;
    payload: DailyReportPayload;
  }>;
}) {
  if (reports.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No reports yet. A daily report is generated automatically each time a business day closes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reports.map((report) => (
        <Card key={report.id}>
          <CardHeader>
            <CardTitle>
              {new Date(report.periodStart).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gross Sales</span>
              <span className="font-medium tabular-nums">
                {report.payload.grossSales.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Transactions</span>
              <span className="font-medium tabular-nums">{report.payload.transactionCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Average Sale</span>
              <span className="font-medium tabular-nums">
                {report.payload.averageSale.toFixed(2)}
              </span>
            </div>
            {report.payload.topProduct && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Top Product</span>
                <span className="font-medium">
                  {report.payload.topProduct.name} ({report.payload.topProduct.revenue.toFixed(2)})
                </span>
              </div>
            )}
            {report.payload.topSalesPerson && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Top Sales Person</span>
                <span className="font-medium">{report.payload.topSalesPerson.name}</span>
              </div>
            )}
            {report.payload.vsPreviousDay && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">vs. Previous Day</span>
                <span className="font-medium tabular-nums">
                  {report.payload.vsPreviousDay.changePercent === null
                    ? "—"
                    : `${report.payload.vsPreviousDay.changePercent >= 0 ? "+" : ""}${report.payload.vsPreviousDay.changePercent.toFixed(1)}%`}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CorrectionsReportPayload, DailyReportPayload } from "@/services/ReportService";

function formatPeriod(periodStart: string) {
  return new Date(periodStart).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function DailyReportCard({ periodStart, payload }: { periodStart: string; payload: DailyReportPayload }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{formatPeriod(periodStart)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Gross Sales</span>
          <span className="font-medium tabular-nums">{payload.grossSales.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Transactions</span>
          <span className="font-medium tabular-nums">{payload.transactionCount}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Average Sale</span>
          <span className="font-medium tabular-nums">{payload.averageSale.toFixed(2)}</span>
        </div>
        {payload.topProduct && (
          <div className="flex justify-between gap-2">
            <span className="shrink-0 text-muted-foreground">Top Product</span>
            <span className="min-w-0 truncate font-medium">
              {payload.topProduct.name} ({payload.topProduct.revenue.toFixed(2)})
            </span>
          </div>
        )}
        {payload.topSalesPerson && (
          <div className="flex justify-between gap-2">
            <span className="shrink-0 text-muted-foreground">Top Sales Person</span>
            <span className="min-w-0 truncate font-medium">{payload.topSalesPerson.name}</span>
          </div>
        )}
        {payload.vsPreviousDay && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">vs. Previous Day</span>
            <span className="font-medium tabular-nums">
              {payload.vsPreviousDay.changePercent === null
                ? "—"
                : `${payload.vsPreviousDay.changePercent >= 0 ? "+" : ""}${payload.vsPreviousDay.changePercent.toFixed(1)}%`}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CorrectionsReportCard({
  periodStart,
  payload,
}: {
  periodStart: string;
  payload: CorrectionsReportPayload;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Corrections &amp; Voids — {formatPeriod(periodStart)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Voided</span>
          <span className="font-medium tabular-nums">
            {payload.voidCount} ({payload.totalVoided.toFixed(2)})
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Corrected</span>
          <span className="font-medium tabular-nums">
            {payload.correctionCount} ({payload.totalCorrectedDelta >= 0 ? "+" : ""}
            {payload.totalCorrectedDelta.toFixed(2)})
          </span>
        </div>
        {payload.reversalCount > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Reversed</span>
            <span className="font-medium tabular-nums">
              {payload.reversalCount} ({payload.totalReversed.toFixed(2)})
            </span>
          </div>
        )}
        <div className="divide-y border-t">
          {payload.entries.map((entry, i) => (
            <div key={i} className="flex flex-col gap-0.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{entry.productName}</span>
                <Badge variant={entry.correctionType === "void" ? "destructive" : "secondary"}>
                  {entry.correctionType}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {entry.saleNumber ?? "—"} · {entry.oldAmount.toFixed(2)}
                {entry.newAmount !== null ? ` → ${entry.newAmount.toFixed(2)}` : ""} · {entry.requestedBy}
              </p>
              <p className="text-xs text-muted-foreground">&ldquo;{entry.reason}&rdquo;</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Daily sales reports + daily corrections/void reports (Phase 3c/3e).
 * Weekly/monthly/custom are later Phase 3 increments. Each report's
 * payload is a frozen snapshot computed at generation time, not
 * re-derived on render.
 */
export function ReportList({
  reports,
}: {
  reports: Array<{
    id: string;
    reportType: string;
    periodStart: string;
    payload: DailyReportPayload | CorrectionsReportPayload;
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
      {reports.map((report) =>
        report.reportType === "corrections_void" ? (
          <CorrectionsReportCard
            key={report.id}
            periodStart={report.periodStart}
            payload={report.payload as CorrectionsReportPayload}
          />
        ) : (
          <DailyReportCard
            key={report.id}
            periodStart={report.periodStart}
            payload={report.payload as DailyReportPayload}
          />
        )
      )}
    </div>
  );
}

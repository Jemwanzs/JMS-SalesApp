import { getLocale, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LOCALE_BCP47, type SupportedLocale } from "@/lib/i18n/config";
import type { CorrectionsReportPayload, DailyReportPayload } from "@/services/ReportService";

function formatPeriod(periodStart: string, bcp47: string) {
  return new Date(periodStart).toLocaleDateString(bcp47, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** Keys into the "Reports" namespace -- see the correction-type Badge's own usage below. */
const CORRECTION_TYPE_LABEL_KEY: Record<string, "correctionTypeVoid" | "correctionTypeCorrect" | "correctionTypeReverse"> = {
  void: "correctionTypeVoid",
  correct: "correctionTypeCorrect",
  reverse: "correctionTypeReverse",
};

async function DailyReportCard({
  periodStart,
  payload,
  bcp47,
  status,
}: {
  periodStart: string;
  payload: DailyReportPayload;
  bcp47: string;
  status: "live" | "final";
}) {
  const t = await getTranslations("Reports");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{formatPeriod(periodStart, bcp47)}</CardTitle>
        <CardAction>
          <Badge variant={status === "live" ? "default" : "secondary"}>
            {status === "live" ? t("todayLive") : t("closedFinal")}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("grossSales")}</span>
          <span className="font-medium tabular-nums">{payload.grossSales.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("transactions")}</span>
          <span className="font-medium tabular-nums">{payload.transactionCount}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("averageSale")}</span>
          <span className="font-medium tabular-nums">{payload.averageSale.toFixed(2)}</span>
        </div>
        {payload.topProduct && (
          <div className="flex justify-between gap-2">
            <span className="shrink-0 text-muted-foreground">{t("topProduct")}</span>
            <span className="min-w-0 truncate font-medium">
              {payload.topProduct.name} ({payload.topProduct.revenue.toFixed(2)})
            </span>
          </div>
        )}
        {payload.topSalesPerson && (
          <div className="flex justify-between gap-2">
            <span className="shrink-0 text-muted-foreground">{t("topSalesPerson")}</span>
            <span className="min-w-0 truncate font-medium">{payload.topSalesPerson.name}</span>
          </div>
        )}
        {payload.vsPreviousDay && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("vsPreviousDay")}</span>
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

async function CorrectionsReportCard({
  periodStart,
  payload,
  bcp47,
}: {
  periodStart: string;
  payload: CorrectionsReportPayload;
  bcp47: string;
}) {
  const t = await getTranslations("Reports");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("correctionsAndVoids", { date: formatPeriod(periodStart, bcp47) })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("voided")}</span>
          <span className="font-medium tabular-nums">
            {payload.voidCount} ({payload.totalVoided.toFixed(2)})
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("corrected")}</span>
          <span className="font-medium tabular-nums">
            {payload.correctionCount} ({payload.totalCorrectedDelta >= 0 ? "+" : ""}
            {payload.totalCorrectedDelta.toFixed(2)})
          </span>
        </div>
        {payload.reversalCount > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("reversed")}</span>
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
                  {t(CORRECTION_TYPE_LABEL_KEY[entry.correctionType])}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {entry.saleNumber ?? "—"} · {entry.oldAmount.toFixed(2)}
                {entry.newAmount !== null ? ` → ${entry.newAmount.toFixed(2)}` : ""} · {entry.requestedBy}
              </p>
              <p className="text-xs text-muted-foreground">{t("quotedReason", { reason: entry.reason })}</p>
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
export async function ReportList({
  reports,
}: {
  reports: Array<{
    id: string;
    reportType: string;
    periodStart: string;
    payload: DailyReportPayload | CorrectionsReportPayload;
    status: "live" | "final";
  }>;
}) {
  const [t, locale] = await Promise.all([getTranslations("Reports"), getLocale()]);
  const bcp47 = LOCALE_BCP47[locale as SupportedLocale];

  if (reports.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {t("noReportsYet")}
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
            bcp47={bcp47}
          />
        ) : (
          <DailyReportCard
            key={report.id}
            periodStart={report.periodStart}
            bcp47={bcp47}
            status={report.status}
            payload={report.payload as DailyReportPayload}
          />
        )
      )}
    </div>
  );
}

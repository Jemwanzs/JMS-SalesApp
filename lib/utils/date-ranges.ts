/**
 * Resolves the analytics dashboard's date-preset buttons (docs/11-
 * analytics-reports.md: "Today | Yesterday | This Week | Last Week |
 * This Month | Last Month | Custom Date | Date Range") into inclusive
 * `sale_date` (YYYY-MM-DD) bounds, computed against a specific tenant's
 * effective "now" -- never raw server UTC, same principle
 * BusinessDayService applies to "today". Week starts Sunday, matching
 * `location_hours.day_of_week`'s existing 0=Sunday convention used
 * throughout onboarding.
 */
export type DatePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month";

export interface DateRange {
  from: string;
  to: string;
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function nowInTimezone(timezone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  // Constructed as a UTC midnight for that calendar date -- only ever used
  // for calendar-day arithmetic (add/subtract days), never compared
  // against a real timestamp, so the artificial UTC anchor is safe.
  return new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00Z`);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

export function resolvePreset(preset: DatePreset, timezone: string): DateRange {
  const today = nowInTimezone(timezone);

  switch (preset) {
    case "today":
      return { from: ymd(today), to: ymd(today) };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: ymd(y), to: ymd(y) };
    }
    case "this_week": {
      const start = addDays(today, -today.getUTCDay());
      return { from: ymd(start), to: ymd(today) };
    }
    case "last_week": {
      const thisWeekStart = addDays(today, -today.getUTCDay());
      const start = addDays(thisWeekStart, -7);
      const end = addDays(thisWeekStart, -1);
      return { from: ymd(start), to: ymd(end) };
    }
    case "this_month": {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      return { from: ymd(start), to: ymd(today) };
    }
    case "last_month": {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
      return { from: ymd(start), to: ymd(end) };
    }
  }
}

export function isSingleDay(range: DateRange): boolean {
  return range.from === range.to;
}

export function todayString(timezone: string): string {
  return ymd(nowInTimezone(timezone));
}

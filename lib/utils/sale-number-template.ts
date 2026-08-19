/**
 * Tenant-configurable sale-number template (docs/08-sales-engine.md).
 * The REAL substitution that assigns a sale's actual number always runs
 * inside the `assign_sale_number()` Postgres trigger (migration 0027,
 * fixed by 0028), atomically alongside the sequence counter -- this
 * file exists for two things that need the SAME token rules without a
 * round trip: rejecting an invalid template before it's ever saved, and
 * a live preview in the settings UI. Keep both in sync with the
 * trigger's own substitution by hand; there's no way to literally share
 * code across SQL and TypeScript here.
 *
 * The sequence placeholder matches ANY digits in braces, not just
 * zeros -- the digit COUNT sets the padding width, regardless of which
 * digits appear. Doc's own worked examples (`{000001}`, `{00001}`,
 * `{0001}`) all end in a literal "1", not all zeros; requiring
 * all-zeros (this file's first draft) rejected the spec's own examples,
 * a real bug caught during live verification, not just theoretical --
 * see migration 0028's header comment.
 */
export const SALE_NUMBER_TEMPLATE_TOKENS = ["{YYYY}", "{YY}", "{MM}", "{DD}", "{DDMMYYYY}", "{YYYYMMDD}", "{LOCATION}"];

const SEQUENCE_PLACEHOLDER = /\{(\d+)\}/;

export function validateSaleNumberTemplate(template: string): string | null {
  const trimmed = template.trim();
  if (!trimmed) {
    return "A template is required";
  }
  if (!SEQUENCE_PLACEHOLDER.test(trimmed)) {
    return "The template must include a sequence placeholder, e.g. {000001}";
  }

  let remaining = trimmed.replace(SEQUENCE_PLACEHOLDER, "");
  for (const token of SALE_NUMBER_TEMPLATE_TOKENS) {
    remaining = remaining.split(token).join("");
  }
  if (/\{[^}]*\}/.test(remaining)) {
    return `Unknown placeholder -- supported: ${SALE_NUMBER_TEMPLATE_TOKENS.join(", ")}, and a zero-padded sequence like {000001}`;
  }

  return null;
}

/** Client-side preview only -- never what actually gets assigned (that's the trigger, atomically, with the real counter). */
export function previewSaleNumber(
  template: string,
  input: { date: Date; locationCode: string | null; sequence: number }
): string {
  const year = input.date.getFullYear();
  const month = String(input.date.getMonth() + 1).padStart(2, "0");
  const day = String(input.date.getDate()).padStart(2, "0");

  let result = template;
  result = result.split("{YYYY}").join(String(year).padStart(4, "0"));
  result = result.split("{YY}").join(String(year % 100).padStart(2, "0"));
  result = result.split("{MM}").join(month);
  result = result.split("{DD}").join(day);
  result = result.split("{DDMMYYYY}").join(`${day}${month}${year}`);
  result = result.split("{YYYYMMDD}").join(`${year}${month}${day}`);
  result = result.split("{LOCATION}").join(input.locationCode ?? "");

  const match = result.match(SEQUENCE_PLACEHOLDER);
  if (match) {
    const width = match[1].length;
    result = result.replace(match[0], String(input.sequence).padStart(width, "0"));
  } else {
    result = `${result}-${String(input.sequence).padStart(6, "0")}`;
  }

  return result;
}

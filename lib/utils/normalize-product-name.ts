/**
 * A stable grouping key for free-text product names entered through the
 * "Others" flow (features/sales/components/record-sale-dialog.tsx) --
 * two entries that only differ by case or incidental whitespace (
 * "Sugar" / "sugar" / "Sugar  ") should roll up into one analytics
 * bucket rather than three. Not used for display -- callers keep the
 * first-seen raw (trimmed) spelling for that.
 */
export function normalizeProductNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Trims and collapses internal whitespace, preserving case -- the
 * display-facing counterpart to normalizeProductNameKey above. */
export function cleanProductName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

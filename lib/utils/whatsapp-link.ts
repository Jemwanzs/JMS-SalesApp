const DEFAULT_COUNTRY_CODE = "254";

/**
 * Normalizes a customer-entered mobile number into the plain digits-only
 * international format wa.me needs -- no spaces, brackets, hyphens, or
 * leading `+`. No phone-number library needed: this app's numbers are
 * always customer-typed local Kenyan format (leading `0`) or already-
 * international, never anything more exotic (confirmed -- no existing
 * phone normalization anywhere in this codebase to build on). The
 * `defaultCountryCode` param keeps the logic itself country-agnostic
 * even though the default matches every other Kenya-first default in
 * this codebase.
 *
 * Examples (Kenya): "0712345678" / "+254712345678" / "254712345678" all
 * normalize to "254712345678".
 */
export function normalizeMobileNumber(raw: string, defaultCountryCode: string = DEFAULT_COUNTRY_CODE): string {
  const digits = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (digits.startsWith("0")) {
    return `${defaultCountryCode}${digits.slice(1)}`;
  }
  return digits;
}

/**
 * Standard wa.me click-to-chat URL -- opens the customer's own WhatsApp
 * (app or Web, device/browser decides which) with the message prefilled
 * but NOT sent; the staff member reviews and presses Send themselves.
 * No API, no credentials, nothing server-side -- see this module's own
 * memory note on why (the original Business-API design was explicitly
 * rejected).
 */
export function buildWhatsAppLink(mobile: string, message?: string, defaultCountryCode?: string): string {
  const normalized = normalizeMobileNumber(mobile, defaultCountryCode);
  const base = `https://wa.me/${normalized}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

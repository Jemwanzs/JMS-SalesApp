/**
 * Pure, DB-free validation for one historical-sales import row (docs/12-
 * imports-data-migration.md's "Validation rules" section). Takes
 * pre-fetched lookup maps (products/locations/members for the tenant)
 * rather than querying per row -- ImportService batch-fetches these
 * once per import, not once per row, to keep a multi-hundred-row
 * validation pass to a handful of queries total.
 *
 * Collects every error on a row, not just the first -- the preview UI
 * (docs' "Row 24 — Product not found" example) shows everything wrong
 * with a row at once, matching how a real spreadsheet-import tool
 * should surface issues.
 */

export interface ImportLookupContext {
  products: { id: string; name: string; sku: string | null; imageUrl: string | null; expectedPrice: number | null }[];
  locations: { id: string; name: string }[];
  members: { profileId: string; fullName: string | null; email: string }[];
  defaultLocationId: string;
  uploadedBy: string;
  /** "Today" in the tenant's own timezone -- see AuthService.evaluateAccessGate's precedent for why this isn't derived from server UTC. */
  todayYmd: string;
}

export interface ValidatedSaleRow {
  saleDate: string;
  saleTime: string;
  productId: string;
  productName: string;
  productImageUrl: string | null;
  productExpectedPrice: number | null;
  amount: number;
  quantity: number | null;
  recordedBy: string;
  locationId: string;
  notes: string | null;
  existingReference: string | null;
}

export interface RowValidationResult<T> {
  valid: boolean;
  errors: string[];
  data?: T;
}

const COLUMN_KEYS = {
  saleDate: ["sale date", "date"],
  saleTime: ["sale time", "time"],
  productName: ["product name", "product"],
  productCode: ["product code", "sku", "code"],
  amount: ["amount", "sale amount"],
  quantity: ["quantity", "qty"],
  salesPerson: ["sales person", "salesperson", "recorded by"],
  location: ["location"],
  existingReference: ["existing reference", "reference"],
  notes: ["notes"],
};

/** docs/10-products.md's bulk-upload column set -- no location/sales-person/
 * date concepts here, this is catalog data, not a transaction record. */
export const PRODUCT_COLUMN_KEYS = {
  name: ["product name", "name"],
  sku: ["product code", "sku", "code"],
  description: ["description"],
  expectedPrice: ["expected price", "price"],
  imageUrl: ["image url", "image"],
};

export interface ProductImportLookupContext {
  /** Lowercased SKUs already on the tenant's catalog -- a bulk-imported
   * row reusing one is almost always a re-run of the same file, not a
   * deliberate second product, so it's treated as an error even though
   * the `products.sku` column itself carries no unique constraint. */
  existingSkus: Set<string>;
}

export interface ValidatedProductRow {
  name: string;
  sku: string | null;
  description: string | null;
  expectedPrice: number | null;
  imageUrl: string | null;
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Maps a worksheet's actual header row to our known field names, case/whitespace-insensitively. */
export function mapHeaders(
  headerRow: (string | null | undefined)[],
  columnKeys: Record<string, string[]> = COLUMN_KEYS
): Record<string, number> {
  const normalized = headerRow.map((h) => (h ? normalizeHeader(String(h)) : ""));
  const map: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(columnKeys)) {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "text" in (value as Record<string, unknown>)) {
    // exceljs rich-text/hyperlink cell shape.
    return String((value as { text: unknown }).text ?? "");
  }
  if (typeof value === "object" && "result" in (value as Record<string, unknown>)) {
    // exceljs formula-cell shape.
    return String((value as { result: unknown }).result ?? "");
  }
  return String(value).trim();
}

/** Excel serial date, a JS Date (exceljs auto-parses formatted date cells), or a common string format. */
function parseDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = cellToString(value);
  if (!s) return null;

  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : s.slice(0, 10);
  }

  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, mm, dd, yyyy] = slashMatch;
    const d = new Date(`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function parseTime(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(11, 19);
  }
  const s = cellToString(value);
  if (!s) return null;
  const match = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, hh, mm, ss] = match;
  const hours = Number(hh);
  const minutes = Number(mm);
  if (hours > 23 || minutes > 59) return null;
  return `${hh.padStart(2, "0")}:${mm}:${(ss ?? "00").padStart(2, "0")}`;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = cellToString(value).replace(/[,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function validateSalesHistoryRow(
  raw: Record<string, unknown>,
  ctx: ImportLookupContext,
  seenReferences: Set<string>
): RowValidationResult<ValidatedSaleRow> {
  const errors: string[] = [];
  const get = (field: keyof typeof COLUMN_KEYS) => raw[field];

  // --- Sale Date (required) ---
  const saleDateRaw = get("saleDate");
  const saleDate = saleDateRaw != null && saleDateRaw !== "" ? parseDate(saleDateRaw) : null;
  if (saleDateRaw == null || saleDateRaw === "") {
    errors.push("Sale date is required");
  } else if (!saleDate) {
    errors.push(`Invalid sale date format: "${cellToString(saleDateRaw)}"`);
  } else if (saleDate > ctx.todayYmd) {
    errors.push(`Sale date cannot be in the future: ${saleDate}`);
  }

  // --- Sale Time (optional) ---
  const saleTimeRaw = get("saleTime");
  let saleTimePart = "12:00:00";
  if (saleTimeRaw != null && saleTimeRaw !== "") {
    const parsedTime = parseTime(saleTimeRaw);
    if (!parsedTime) {
      errors.push(`Invalid sale time format: "${cellToString(saleTimeRaw)}"`);
    } else {
      saleTimePart = parsedTime;
    }
  }

  // --- Product (required, by name or code) ---
  const productNameRaw = cellToString(get("productName"));
  const productCodeRaw = cellToString(get("productCode"));
  let matchedProduct: ImportLookupContext["products"][number] | null = null;
  if (productCodeRaw) {
    const bySku = ctx.products.find((p) => p.sku?.toLowerCase() === productCodeRaw.toLowerCase());
    if (bySku) matchedProduct = bySku;
  }
  if (!matchedProduct && productNameRaw) {
    const byName = ctx.products.find((p) => p.name.toLowerCase() === productNameRaw.toLowerCase());
    if (byName) matchedProduct = byName;
  }
  if (!productNameRaw && !productCodeRaw) {
    errors.push("Product name or product code is required");
  } else if (!matchedProduct) {
    errors.push(`Product not found: "${productCodeRaw || productNameRaw}"`);
  }

  // --- Amount (required, non-negative) ---
  const amountRaw = get("amount");
  let amount: number | null = null;
  if (amountRaw == null || amountRaw === "") {
    errors.push("Amount is required");
  } else {
    amount = parseNumber(amountRaw);
    if (amount == null) {
      errors.push(`Invalid amount format: "${cellToString(amountRaw)}"`);
    } else if (amount < 0) {
      errors.push(`Amount cannot be negative: ${amount}`);
    }
  }

  // --- Quantity (optional, positive) ---
  const quantityRaw = get("quantity");
  let quantity: number | null = null;
  if (quantityRaw != null && quantityRaw !== "") {
    quantity = parseNumber(quantityRaw);
    if (quantity == null || quantity <= 0) {
      errors.push(`Invalid quantity: "${cellToString(quantityRaw)}"`);
      quantity = null;
    }
  }

  // --- Sales Person (required -- must match a sales.create-holding member) ---
  const salesPersonRaw = cellToString(get("salesPerson"));
  let recordedBy: string | null = null;
  if (!salesPersonRaw) {
    errors.push("Sales person is required");
  } else {
    const member = ctx.members.find(
      (m) =>
        m.email.toLowerCase() === salesPersonRaw.toLowerCase() ||
        (m.fullName && m.fullName.toLowerCase() === salesPersonRaw.toLowerCase())
    );
    if (!member) {
      errors.push(`Sales person not found: "${salesPersonRaw}"`);
    } else {
      recordedBy = member.profileId;
    }
  }

  // --- Location (optional -> tenant's primary location; provided-but-unknown is an error) ---
  const locationRaw = cellToString(get("location"));
  let locationId = ctx.defaultLocationId;
  if (locationRaw) {
    const location = ctx.locations.find((l) => l.name.toLowerCase() === locationRaw.toLowerCase());
    if (!location) {
      errors.push(`Location not found: "${locationRaw}"`);
    } else {
      locationId = location.id;
    }
  }

  // --- Existing Reference (optional, deduplicated within this batch) ---
  const existingReferenceRaw = cellToString(get("existingReference")) || null;
  if (existingReferenceRaw) {
    const key = existingReferenceRaw.toLowerCase();
    if (seenReferences.has(key)) {
      errors.push(`Duplicate existing reference in this file: "${existingReferenceRaw}"`);
    } else {
      seenReferences.add(key);
    }
  }

  const notes = cellToString(get("notes")) || null;

  if (errors.length > 0 || !saleDate || !matchedProduct || amount == null || !recordedBy) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: {
      saleDate,
      saleTime: `${saleDate}T${saleTimePart}Z`,
      productId: matchedProduct.id,
      productName: matchedProduct.name,
      productImageUrl: matchedProduct.imageUrl,
      productExpectedPrice: matchedProduct.expectedPrice,
      amount,
      quantity,
      recordedBy,
      locationId,
      notes,
      existingReference: existingReferenceRaw,
    },
  };
}

function parseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** docs/10-products.md's bulk-upload validation: name required; SKU/price/
 * image format checks only where a value is actually provided; SKU
 * uniqueness checked both within this file and against the tenant's
 * existing catalog (see ProductImportLookupContext for why). */
export function validateProductRow(
  raw: Record<string, unknown>,
  ctx: ProductImportLookupContext,
  seenSkus: Set<string>
): RowValidationResult<ValidatedProductRow> {
  const errors: string[] = [];
  const get = (field: keyof typeof PRODUCT_COLUMN_KEYS) => raw[field];

  // --- Product Name (required) ---
  const name = cellToString(get("name"));
  if (!name) {
    errors.push("Product name is required");
  }

  // --- SKU / Product Code (optional, unique within file + against existing catalog) ---
  const skuRaw = cellToString(get("sku")) || null;
  if (skuRaw) {
    const key = skuRaw.toLowerCase();
    if (seenSkus.has(key)) {
      errors.push(`Duplicate product code in this file: "${skuRaw}"`);
    } else if (ctx.existingSkus.has(key)) {
      errors.push(`A product with this code already exists: "${skuRaw}"`);
    } else {
      seenSkus.add(key);
    }
  }

  // --- Description (optional) ---
  const description = cellToString(get("description")) || null;

  // --- Expected Price (optional, non-negative) ---
  const expectedPriceRaw = get("expectedPrice");
  let expectedPrice: number | null = null;
  if (expectedPriceRaw != null && expectedPriceRaw !== "") {
    expectedPrice = parseNumber(expectedPriceRaw);
    if (expectedPrice == null) {
      errors.push(`Invalid expected price format: "${cellToString(expectedPriceRaw)}"`);
    } else if (expectedPrice < 0) {
      errors.push(`Expected price cannot be negative: ${expectedPrice}`);
      expectedPrice = null;
    }
  }

  // --- Image URL (optional, must be http(s)) ---
  const imageUrlRaw = cellToString(get("imageUrl")) || null;
  let imageUrl: string | null = null;
  if (imageUrlRaw) {
    imageUrl = parseUrl(imageUrlRaw);
    if (!imageUrl) {
      errors.push(`Invalid image URL: "${imageUrlRaw}"`);
    }
  }

  if (errors.length > 0 || !name) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: { name, sku: skuRaw, description, expectedPrice, imageUrl },
  };
}

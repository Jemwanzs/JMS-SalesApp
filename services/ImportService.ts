import type { SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { Readable } from "node:stream";

import { InsightsService } from "@/services/InsightsService";
import type { Database, ImportType } from "@/types/database.types";
import {
  mapHeaders,
  validateSalesHistoryRow,
  validateProductRow,
  PRODUCT_COLUMN_KEYS,
  type ImportLookupContext,
  type ProductImportLookupContext,
} from "@/lib/imports/row-validation";

/**
 * ImportService — bulk-upload workflow (docs/12-imports-data-migration.md
 * for `type = 'sales_history'`; docs/10-products.md for `type =
 * 'products'`): template -> upload -> validate -> preview -> resolve
 * errors -> confirm. Both types share the imports/import_rows schema
 * (migration 0020) and the same generic per-row/per-import flow;
 * generateTemplate/validateImport/confirmImport each dispatch on the
 * import's own `type` column for the parts that actually differ (which
 * columns, which validator, what confirm ultimately writes). Products
 * import has no "historical business day" or analytics-rebuild concept
 * the way sales history does -- confirming it is a much shorter, direct
 * insert into `products`.
 *
 * ALWAYS constructed with the service-role client (added to lib/
 * supabase/service-role.ts's allowed-callers list) -- see migration
 * 0020's header comment for why: confirming an import writes across
 * import_rows + business_days + sales as one consistent bulk operation,
 * and a historical business day is correctly 'closed' (never 'open'),
 * which the live-capture-shaped business_day.open/sales.create RLS
 * policies would otherwise reject. Every server action calling this
 * service checks `imports.manage` explicitly first via the RLS-
 * respecting client, same two-step pattern as TenantService.createTenant
 * and UserService.inviteUser.
 *
 * Historical sales reuse `sales`' exact schema/triggers/idempotency
 * conventions (assign_sale_number, the (tenant_id, idempotency_key)
 * uniqueness constraint) -- "the same insert path as live-captured
 * sales" the doc calls for, at the level that actually matters (same
 * table, same triggers, same snapshot fields), not a literal call to
 * SalesService.recordSale() (whose "business day must be open" gate is
 * a live-capture UX guard that doesn't apply to historical backfill).
 * Each row's own import_rows.id is used as its sale's idempotency_key,
 * so a retried confirm can never double-insert.
 */
const SALES_HISTORY_TEMPLATE_COLUMNS = [
  { header: "Sale Date", required: true, example: "2024-03-15" },
  { header: "Sale Time", required: false, example: "14:30" },
  { header: "Product Name", required: true, example: "Espresso" },
  { header: "Amount", required: true, example: 4.5 },
  { header: "Quantity", required: false, example: 1 },
  { header: "Sales Person", required: true, example: "jane@example.com" },
  { header: "Location", required: false, example: "Main" },
  { header: "Existing Reference", required: false, example: "POS-10293" },
  { header: "Notes", required: false, example: "" },
] as const;

// Warm cream, used only to mark a required column's header cell -- purely
// visual, doesn't affect parsing (mapHeaders matches on text, not fill).
const REQUIRED_HEADER_FILL = "FFFFF2CC";
const OPTIONAL_HEADER_FILL = "FFE5E7EB";
/** Data-validation dropdowns apply to this many data rows below the header. */
const TEMPLATE_DATA_ROW_COUNT = 1000;

const PRODUCTS_TEMPLATE_COLUMNS = [
  { header: "Product Name", required: true, example: "Espresso" },
  { header: "Product Code", required: false, example: "ESP-001" },
  { header: "Description", required: false, example: "Single shot, house blend" },
  { header: "Expected Price", required: false, example: 4.5 },
  { header: "Image URL", required: false, example: "" },
] as const;

/** Applies an Excel dropdown (data-validation list) to every data row of one column, referencing a range on the hidden Lists sheet. */
function applyListValidation(sheet: ExcelJS.Worksheet, colIndex: number, range: string): void {
  for (let row = 2; row <= TEMPLATE_DATA_ROW_COUNT + 1; row++) {
    sheet.getCell(row, colIndex).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [range],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: "Not in the list",
      error: "Pick a value from the dropdown so it matches exactly -- typing a close match won't import correctly.",
    };
  }
}

export interface ImportSummary {
  id: string;
  type: ImportType;
  status: string;
  fileName: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  importedRows: number;
  createdAt: string;
}

export interface ImportRowView {
  id: string;
  rowNumber: number;
  rawData: Record<string, unknown>;
  status: string;
  errors: string[] | null;
  resolvedData: Record<string, unknown> | null;
}

export class ImportService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /**
   * docs/12's "Historical sales template" table, as a real downloadable
   * .xlsx -- now tenant-specific (product-enhancements batch): Product
   * Name and Sales Person are real Excel dropdowns backed by this
   * tenant's own active catalog and its `sales.create`-holding members,
   * on a hidden "Lists" sheet (dataValidation formulae can reference a
   * hidden sheet's range fine; inline list formulae would hit Excel's
   * 255-char limit and break on names containing commas). Product Code
   * is dropped entirely -- Product Name's dropdown makes exact-name
   * matching reliable enough that a separate SKU column added more
   * confusion than value. Required columns' header cells are filled
   * warm cream instead of the neutral gray optional columns get, so
   * "what do I have to fill in" is visible without opening the
   * Instructions sheet at all.
   */
  async generateSalesHistoryTemplate(tenantId: string): Promise<Buffer> {
    const [{ data: products }, salesPeople] = await Promise.all([
      this.supabase.from("products").select("name").eq("tenant_id", tenantId).eq("status", "active").order("name"),
      this.listSalesCapturePeople(tenantId),
    ]);

    const productNames = [...new Set((products ?? []).map((p) => p.name))];
    const salesPersonEmails = salesPeople.map((m) => m.email);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sales History");

    // Header text stays byte-for-byte the plain column name (no "*"
    // suffix or other decoration) -- mapHeaders() matches on exact
    // normalized header text, and this is the same template our own
    // parser reads back, so anything that would make a header not
    // round-trip is a bug, not a cosmetic choice. Which columns are
    // required also lives on the Instructions sheet, in addition to the
    // header-cell coloring below.
    sheet.columns = SALES_HISTORY_TEMPLATE_COLUMNS.map((c) => ({
      header: c.header,
      key: c.header,
      width: 20,
    }));

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    SALES_HISTORY_TEMPLATE_COLUMNS.forEach((c, i) => {
      headerRow.getCell(i + 1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: c.required ? REQUIRED_HEADER_FILL : OPTIONAL_HEADER_FILL },
      };
    });

    sheet.addRow(Object.fromEntries(SALES_HISTORY_TEMPLATE_COLUMNS.map((c) => [c.header, c.example])));
    const exampleRow = sheet.getRow(2);
    exampleRow.font = { italic: true, color: { argb: "FF6B7280" } };

    // Hidden reference lists the two dropdowns point at -- kept on a
    // separate sheet (not inline formulae) so a long catalog or a
    // product name containing a comma both work correctly.
    const listsSheet = workbook.addWorksheet("Lists");
    listsSheet.state = "veryHidden";
    listsSheet.getColumn(1).values = ["Product Names", ...productNames];
    listsSheet.getColumn(2).values = ["Sales People", ...salesPersonEmails];

    const productNameColIndex = SALES_HISTORY_TEMPLATE_COLUMNS.findIndex((c) => c.header === "Product Name") + 1;
    const salesPersonColIndex = SALES_HISTORY_TEMPLATE_COLUMNS.findIndex((c) => c.header === "Sales Person") + 1;

    if (productNames.length > 0) {
      applyListValidation(sheet, productNameColIndex, `Lists!$A$2:$A$${productNames.length + 1}`);
    }
    if (salesPersonEmails.length > 0) {
      applyListValidation(sheet, salesPersonColIndex, `Lists!$B$2:$B$${salesPersonEmails.length + 1}`);
    }

    const notesSheet = workbook.addWorksheet("Instructions");
    notesSheet.columns = [
      { header: "Column", key: "column", width: 22 },
      { header: "Required?", key: "required", width: 12 },
      { header: "Notes", key: "notes", width: 60 },
    ];
    notesSheet.getRow(1).font = { bold: true };
    notesSheet.addRows([
      { column: "Sale Date", required: "Yes", notes: "Format: YYYY-MM-DD (e.g. 2024-03-15). Cannot be a future date." },
      { column: "Sale Time", required: "No", notes: "Format: HH:MM (24-hour). Defaults to midday if left blank." },
      { column: "Product Name", required: "Yes", notes: "Pick from the dropdown -- it lists this business's active products. Must match one exactly." },
      { column: "Amount", required: "Yes", notes: "The total amount charged for the sale (not a per-unit price). Must be 0 or more." },
      { column: "Quantity", required: "No", notes: "Informational only -- a positive number." },
      {
        column: "Sales Person",
        required: "Yes",
        notes:
          salesPersonEmails.length > 0
            ? "Pick from the dropdown -- it lists team members who can record sales. Must match one exactly."
            : "No team member currently holds sales-recording permission for this business -- assign one under Users before importing.",
      },
      { column: "Location", required: "No", notes: "Must match an existing location name exactly. Defaults to your primary location if left blank." },
      { column: "Existing Reference", required: "No", notes: "Your own external reference (e.g. a POS receipt number). Must be unique within this file." },
      { column: "Notes", required: "No", notes: "Free text, carried over onto the imported sale." },
    ]);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Tenant members eligible to be picked as a historical sale's "Sales
   * Person" -- active membership + a role granting sales.create,
   * mirroring has_permission()'s own join shape (role_permissions ->
   * user_role_assignments -> tenant_memberships) since this runs from
   * the service-role client, outside any one user's auth.uid() context.
   * Falls back to every active member if literally no one currently
   * holds sales.create (a brand-new tenant before roles are assigned)
   * so a historical import is never hard-blocked by that gap.
   */
  private async listSalesCapturePeople(
    tenantId: string
  ): Promise<{ profileId: string; email: string; fullName: string | null }[]> {
    const { data: permission } = await this.supabase
      .from("permissions")
      .select("id")
      .eq("key", "sales.create")
      .maybeSingle();

    let eligibleMembershipIds: Set<string> | null = null;

    if (permission) {
      const { data: roles } = await this.supabase
        .from("role_permissions")
        .select("role_id")
        .eq("permission_id", permission.id);
      const roleIds = [...new Set((roles ?? []).map((r) => r.role_id))];

      if (roleIds.length > 0) {
        const { data: assignments } = await this.supabase
          .from("user_role_assignments")
          .select("tenant_membership_id")
          .eq("tenant_id", tenantId)
          .in("role_id", roleIds);
        eligibleMembershipIds = new Set((assignments ?? []).map((a) => a.tenant_membership_id));
      }
    }

    let membershipsQuery = this.supabase
      .from("tenant_memberships")
      .select("id, profile_id")
      .eq("tenant_id", tenantId)
      .eq("status", "active");
    if (eligibleMembershipIds && eligibleMembershipIds.size > 0) {
      membershipsQuery = membershipsQuery.in("id", [...eligibleMembershipIds]);
    }
    const { data: memberships } = await membershipsQuery;

    const profileIds = (memberships ?? []).map((m) => m.profile_id);
    if (profileIds.length === 0) return [];

    const { data: profiles } = await this.supabase.from("profiles").select("id, email, full_name").in("id", profileIds);
    return (profiles ?? [])
      .map((p) => ({ profileId: p.id, email: p.email, fullName: p.full_name }))
      .sort((a, b) => a.email.localeCompare(b.email));
  }

  /** docs/10-products.md's bulk product-catalog template. */
  async generateProductsTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Products");

    sheet.columns = PRODUCTS_TEMPLATE_COLUMNS.map((c) => ({
      header: c.header,
      key: c.header,
      width: 24,
    }));

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };

    sheet.addRow(Object.fromEntries(PRODUCTS_TEMPLATE_COLUMNS.map((c) => [c.header, c.example])));
    const exampleRow = sheet.getRow(2);
    exampleRow.font = { italic: true, color: { argb: "FF6B7280" } };

    const notesSheet = workbook.addWorksheet("Instructions");
    notesSheet.columns = [
      { header: "Column", key: "column", width: 22 },
      { header: "Required?", key: "required", width: 12 },
      { header: "Notes", key: "notes", width: 60 },
    ];
    notesSheet.getRow(1).font = { bold: true };
    notesSheet.addRows([
      { column: "Product Name", required: "Yes", notes: "The product's display name." },
      { column: "Product Code", required: "No", notes: "Your own SKU. Must be unique -- both within this file and against your existing catalog." },
      { column: "Description", required: "No", notes: "Free text shown on the product's detail view." },
      { column: "Expected Price", required: "No", notes: "Must be 0 or more if provided." },
      { column: "Image URL", required: "No", notes: "A direct link (http/https) to an image. Leave blank to add a photo later from the product's page." },
    ]);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async createImport(input: {
    tenantId: string;
    type: ImportType;
    fileBuffer: Buffer;
    fileName: string;
    uploadedBy: string;
  }): Promise<{ importId: string }> {
    const storagePath = `${input.tenantId}/${Date.now()}-${input.fileName}`;

    const { error: uploadError } = await this.supabase.storage
      .from("imports")
      .upload(storagePath, input.fileBuffer, {
        contentType: input.fileName.toLowerCase().endsWith(".csv")
          ? "text/csv"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

    if (uploadError) {
      throw new Error(`ImportService.createImport: ${uploadError.message}`);
    }

    const { data, error } = await this.supabase
      .from("imports")
      .insert({
        tenant_id: input.tenantId,
        type: input.type,
        file_storage_path: storagePath,
        file_name: input.fileName,
        uploaded_by: input.uploadedBy,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(`ImportService.createImport: ${error?.message}`);
    }

    return { importId: data.id };
  }

  /**
   * Downloads the uploaded file, parses every row, validates it against
   * every tenant lookup fetched ONCE up front (not per row), and writes
   * one import_rows entry per row. Practical row-count ceiling for this
   * pass: single request/response cycle, so very large files (tens of
   * thousands of rows) aren't handled here -- see docs/20-development-
   * progress.md's decision log for why this wasn't built as a
   * background job (Vercel Cron is once-daily on this project's Hobby
   * plan, unusable for an interactive "upload, see results" flow; a
   * per-file worker is a real future option if row counts demand it).
   */
  async validateImport(importId: string, tenantId: string): Promise<void> {
    const { data: importRow, error: importError } = await this.supabase
      .from("imports")
      .select("id, type, file_storage_path, file_name, uploaded_by")
      .eq("id", importId)
      .eq("tenant_id", tenantId)
      .single();

    if (importError || !importRow) {
      throw new Error(`ImportService.validateImport: import not found`);
    }

    await this.supabase.from("imports").update({ status: "validating" }).eq("id", importId);

    try {
      const { data: fileData, error: downloadError } = await this.supabase.storage
        .from("imports")
        .download(importRow.file_storage_path);

      if (downloadError || !fileData) {
        throw new Error(`could not download uploaded file: ${downloadError?.message}`);
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());
      const worksheet = await parseWorksheet(buffer, importRow.file_name);
      const headerMap = mapHeaders(
        worksheet.getRow(1).values as (string | null | undefined)[],
        importRow.type === "products" ? PRODUCT_COLUMN_KEYS : undefined
      );

      const salesCtx = importRow.type === "products" ? null : await this.buildLookupContext(tenantId, importRow.uploaded_by);
      const productsCtx = importRow.type === "products" ? await this.buildProductLookupContext(tenantId) : null;
      const seenReferences = new Set<string>();
      const seenSkus = new Set<string>();

      const rowsToInsert: Database["public"]["Tables"]["import_rows"]["Insert"][] = [];
      let validCount = 0;
      let errorCount = 0;

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // header
        const values = row.values as unknown[];
        if (values.every((v) => v == null || v === "")) return; // fully blank row

        const raw: Record<string, unknown> = {};
        for (const [field, colIndex] of Object.entries(headerMap)) {
          // Both header and data rows share exceljs's 1-indexed Row.values
          // shape (values[0] is always undefined) -- mapImportHeaders
          // returns that SAME 1-indexed position, so no offset here.
          raw[field] = values[colIndex] ?? null;
        }

        const result =
          importRow.type === "products"
            ? validateProductRow(raw, productsCtx!, seenSkus)
            : validateSalesHistoryRow(raw, salesCtx!, seenReferences);
        if (result.valid) validCount++;
        else errorCount++;

        rowsToInsert.push({
          tenant_id: tenantId,
          import_id: importId,
          row_number: rowNumber,
          raw_data: raw,
          status: result.valid ? "valid" : "invalid",
          errors: result.errors.length > 0 ? result.errors : null,
          resolved_data: (result.data as unknown as Record<string, unknown>) ?? null,
        });
      });

      if (rowsToInsert.length > 0) {
        const { error: insertError } = await this.supabase.from("import_rows").insert(rowsToInsert);
        if (insertError) {
          throw new Error(`failed to write import_rows: ${insertError.message}`);
        }
      }

      await this.supabase
        .from("imports")
        .update({
          status: "validated",
          total_rows: rowsToInsert.length,
          valid_rows: validCount,
          error_rows: errorCount,
        })
        .eq("id", importId);
    } catch (err) {
      await this.supabase
        .from("imports")
        .update({ status: "failed", failure_reason: err instanceof Error ? err.message : String(err) })
        .eq("id", importId);
      throw err;
    }
  }

  async listImports(tenantId: string): Promise<ImportSummary[]> {
    const { data, error } = await this.supabase
      .from("imports")
      .select("id, type, status, file_name, total_rows, valid_rows, error_rows, imported_rows, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`ImportService.listImports: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      fileName: row.file_name,
      totalRows: row.total_rows,
      validRows: row.valid_rows,
      errorRows: row.error_rows,
      importedRows: row.imported_rows,
      createdAt: row.created_at,
    }));
  }

  async getImport(importId: string, tenantId: string): Promise<ImportSummary | null> {
    const { data } = await this.supabase
      .from("imports")
      .select("id, type, status, file_name, total_rows, valid_rows, error_rows, imported_rows, created_at")
      .eq("id", importId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!data) return null;

    return {
      id: data.id,
      type: data.type,
      status: data.status,
      fileName: data.file_name,
      totalRows: data.total_rows,
      validRows: data.valid_rows,
      errorRows: data.error_rows,
      importedRows: data.imported_rows,
      createdAt: data.created_at,
    };
  }

  async listRows(
    importId: string,
    tenantId: string,
    opts: { onlyInvalid?: boolean } = {}
  ): Promise<ImportRowView[]> {
    let query = this.supabase
      .from("import_rows")
      .select("id, row_number, raw_data, status, errors, resolved_data")
      .eq("import_id", importId)
      .eq("tenant_id", tenantId)
      .order("row_number", { ascending: true });

    if (opts.onlyInvalid) {
      query = query.eq("status", "invalid");
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`ImportService.listRows: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      rowNumber: row.row_number,
      rawData: row.raw_data,
      status: row.status,
      errors: row.errors,
      resolvedData: row.resolved_data,
    }));
  }

  /**
   * The preview UI's on-screen fix: the caller supplies corrected raw
   * field values (e.g. picking the right product), which are re-run
   * through the SAME validateSalesHistoryRow() the bulk pass used --
   * never a separate, looser check for the "fixed on screen" path.
   */
  async resolveRow(
    rowId: string,
    tenantId: string,
    correctedFields: Record<string, unknown>
  ): Promise<{ valid: boolean; errors: string[] }> {
    const { data: row, error: rowError } = await this.supabase
      .from("import_rows")
      .select("id, tenant_id, import_id, raw_data")
      .eq("id", rowId)
      .eq("tenant_id", tenantId)
      .single();

    if (rowError || !row) {
      throw new Error(`ImportService.resolveRow: row not found`);
    }

    const { data: importRow, error: importRowError } = await this.supabase
      .from("imports")
      .select("type, uploaded_by")
      .eq("id", row.import_id)
      .single();

    if (importRowError || !importRow) {
      throw new Error(`ImportService.resolveRow: parent import not found`);
    }

    const merged = { ...row.raw_data, ...correctedFields };

    // Duplicate-reference/duplicate-SKU detection is a whole-batch
    // concern; re-checking it for one row in isolation would either
    // always pass (nothing else in scope) or need every other row's
    // value re-fetched for no real benefit -- a corrected value that
    // collides with another row gets caught the next time the whole
    // import is (re-)validated.
    const result =
      importRow.type === "products"
        ? validateProductRow(merged, await this.buildProductLookupContext(tenantId), new Set())
        : validateSalesHistoryRow(merged, await this.buildLookupContext(tenantId, importRow.uploaded_by), new Set());

    const { error: updateError } = await this.supabase
      .from("import_rows")
      .update({
        raw_data: merged,
        status: result.valid ? "valid" : "invalid",
        errors: result.errors.length > 0 ? result.errors : null,
        resolved_data: (result.data as unknown as Record<string, unknown>) ?? null,
      })
      .eq("id", rowId);

    if (updateError) {
      throw new Error(`ImportService.resolveRow: ${updateError.message}`);
    }

    await this.recountImport(row.import_id);

    return { valid: result.valid, errors: result.errors };
  }

  /** Keeps imports.valid_rows/error_rows in sync after a resolveRow flips a row's status. */
  private async recountImport(importId: string): Promise<void> {
    const { data: rows } = await this.supabase.from("import_rows").select("status").eq("import_id", importId);
    const validCount = (rows ?? []).filter((r) => r.status === "valid").length;
    const errorCount = (rows ?? []).filter((r) => r.status === "invalid").length;

    await this.supabase
      .from("imports")
      .update({ valid_rows: validCount, error_rows: errorCount })
      .eq("id", importId);
  }

  /**
   * Only currently-'valid' rows are processed -- rows still 'invalid'
   * are left untouched (not force-skipped), so a partial import is
   * always safe to confirm now and finish resolving later via a fresh
   * upload. Groups touched (location, date) pairs into historical
   * business_days (status 'closed' -- never 'open', it's backfill, not
   * a live capture window), inserts sales, recomputes aggregates for
   * every touched day, then triggers the SAME insights pipeline a live
   * business-day close does (docs' "analytics rebuild trigger") --
   * called directly and synchronously here, not queued through the
   * report_jobs outbox, since that drains only once a day on this
   * project's Hobby-plan Vercel Cron and "immediately appears in
   * dashboards" is the whole point of this step. A report_jobs row is
   * still queued per touched day for the daily report artifact itself,
   * matching what a live close already does.
   */
  async confirmImport(
    importId: string,
    tenantId: string,
    confirmedBy: string
  ): Promise<{ imported: number; skipped: number }> {
    const { data: importRow, error: importError } = await this.supabase
      .from("imports")
      .select("type")
      .eq("id", importId)
      .eq("tenant_id", tenantId)
      .single();

    if (importError || !importRow) {
      throw new Error(`ImportService.confirmImport: import not found`);
    }

    if (importRow.type === "products") {
      return this.confirmProductsImport(importId, tenantId, confirmedBy);
    }
    return this.confirmSalesHistoryImport(importId, tenantId, confirmedBy);
  }

  private async confirmSalesHistoryImport(
    importId: string,
    tenantId: string,
    confirmedBy: string
  ): Promise<{ imported: number; skipped: number }> {
    const { data: rows, error: rowsError } = await this.supabase
      .from("import_rows")
      .select("id, resolved_data")
      .eq("import_id", importId)
      .eq("tenant_id", tenantId)
      .eq("status", "valid")
      .order("row_number", { ascending: true });

    if (rowsError) {
      throw new Error(`ImportService.confirmImport: ${rowsError.message}`);
    }

    const validRows = (rows ?? []).filter(
      (r): r is typeof r & { resolved_data: NonNullable<typeof r.resolved_data> } => r.resolved_data != null
    );

    await this.supabase.from("imports").update({ status: "importing" }).eq("id", importId);

    const businessDayIdByKey = new Map<string, string>();
    let imported = 0;
    let skipped = 0;

    for (const row of validRows) {
      const data = row.resolved_data as {
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
      };

      const dayKey = `${data.locationId}|${data.saleDate}`;
      let businessDayId = businessDayIdByKey.get(dayKey);

      if (!businessDayId) {
        businessDayId = await this.findOrCreateHistoricalBusinessDay(tenantId, data.locationId, data.saleDate);
        businessDayIdByKey.set(dayKey, businessDayId);
      }

      const { data: inserted, error: insertError } = await this.supabase
        .from("sales")
        .insert({
          tenant_id: tenantId,
          location_id: data.locationId,
          business_day_id: businessDayId,
          product_id: data.productId,
          product_name_snapshot: data.productName,
          product_image_snapshot: data.productImageUrl,
          expected_price_snapshot: data.productExpectedPrice,
          actual_amount: data.amount,
          quantity: data.quantity,
          notes: data.notes,
          recorded_by: data.recordedBy,
          sale_date: data.saleDate,
          sale_time: data.saleTime,
          idempotency_key: row.id,
        })
        .select("id")
        .maybeSingle();

      if (insertError && !isUniqueViolation(insertError)) {
        await this.supabase
          .from("import_rows")
          .update({ status: "skipped", errors: [`Import failed: ${insertError.message}`] })
          .eq("id", row.id);
        skipped++;
        continue;
      }

      let saleId = inserted?.id ?? null;

      if (!saleId) {
        // Conflict on (tenant_id, idempotency_key) -- this row was
        // already imported by an earlier confirm call (a retry/double
        // -click). sales.id is its own generated uuid, NOT row.id, so
        // the existing row must be looked up -- same idempotent-replay
        // pattern SalesService.recordSale() already uses.
        const { data: existingSale } = await this.supabase
          .from("sales")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("idempotency_key", row.id)
          .single();
        saleId = existingSale?.id ?? null;
      }

      if (!saleId) {
        await this.supabase
          .from("import_rows")
          .update({ status: "skipped", errors: ["Import failed: could not resolve the inserted sale"] })
          .eq("id", row.id);
        skipped++;
        continue;
      }

      await this.supabase
        .from("import_rows")
        .update({ status: "imported", created_entity_id: saleId })
        .eq("id", row.id);
      imported++;
    }

    for (const businessDayId of businessDayIdByKey.values()) {
      await this.recomputeBusinessDayAggregates(businessDayId);
      await new InsightsService(this.supabase).evaluateDailyInsights(businessDayId).catch(() => {});

      const { data: day } = await this.supabase
        .from("business_days")
        .select("tenant_id, location_id")
        .eq("id", businessDayId)
        .single();

      if (day) {
        await this.supabase.from("report_jobs").insert({
          tenant_id: day.tenant_id,
          job_type: "daily_business_day_report",
          payload: { business_day_id: businessDayId, location_id: day.location_id },
        });
      }
    }

    await this.supabase
      .from("imports")
      .update({
        status: "completed",
        imported_rows: imported,
        confirmed_by: confirmedBy,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", importId);

    return { imported, skipped };
  }

  /**
   * Direct inserts into `products`, mirroring ProductService.create's
   * insert shape but not calling it -- a per-row SELECT-then-INSERT for
   * display_order would be N+1 across a whole file, so the running max
   * is tracked locally instead, incremented once per row. No product_
   * images row is created even when an Image URL was provided: that
   * table exists for Storage-backed uploads (path + cleanup bookkeeping
   * ProductService owns), and a bulk-imported row only ever carries an
   * external URL -- ProductService.create's own logic already treats
   * imageUrl-without-imageStoragePath as "just set products.image_url,
   * no Storage-backed row", the exact behavior wanted here.
   */
  private async confirmProductsImport(
    importId: string,
    tenantId: string,
    confirmedBy: string
  ): Promise<{ imported: number; skipped: number }> {
    const { data: rows, error: rowsError } = await this.supabase
      .from("import_rows")
      .select("id, resolved_data")
      .eq("import_id", importId)
      .eq("tenant_id", tenantId)
      .eq("status", "valid")
      .order("row_number", { ascending: true });

    if (rowsError) {
      throw new Error(`ImportService.confirmImport: ${rowsError.message}`);
    }

    const validRows = (rows ?? []).filter(
      (r): r is typeof r & { resolved_data: NonNullable<typeof r.resolved_data> } => r.resolved_data != null
    );

    await this.supabase.from("imports").update({ status: "importing" }).eq("id", importId);

    const { data: maxOrder } = await this.supabase
      .from("products")
      .select("display_order")
      .eq("tenant_id", tenantId)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextDisplayOrder = (maxOrder?.display_order ?? -1) + 1;
    let imported = 0;
    let skipped = 0;

    for (const row of validRows) {
      const data = row.resolved_data as {
        name: string;
        sku: string | null;
        description: string | null;
        expectedPrice: number | null;
        imageUrl: string | null;
      };

      const { data: inserted, error: insertError } = await this.supabase
        .from("products")
        .insert({
          tenant_id: tenantId,
          name: data.name,
          sku: data.sku,
          description: data.description,
          expected_price: data.expectedPrice,
          image_url: data.imageUrl,
          display_order: nextDisplayOrder,
          created_by: confirmedBy,
        })
        .select("id")
        .single();

      if (insertError || !inserted) {
        await this.supabase
          .from("import_rows")
          .update({ status: "skipped", errors: [`Import failed: ${insertError?.message}`] })
          .eq("id", row.id);
        skipped++;
        continue;
      }

      nextDisplayOrder++;
      await this.supabase
        .from("import_rows")
        .update({ status: "imported", created_entity_id: inserted.id })
        .eq("id", row.id);
      imported++;
    }

    await this.supabase
      .from("imports")
      .update({
        status: "completed",
        imported_rows: imported,
        confirmed_by: confirmedBy,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", importId);

    return { imported, skipped };
  }

  private async findOrCreateHistoricalBusinessDay(
    tenantId: string,
    locationId: string,
    businessDate: string
  ): Promise<string> {
    const { data: existing } = await this.supabase
      .from("business_days")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("location_id", locationId)
      .eq("business_date", businessDate)
      .maybeSingle();

    if (existing) return existing.id;

    const { data: created, error } = await this.supabase
      .from("business_days")
      .insert({
        tenant_id: tenantId,
        location_id: locationId,
        business_date: businessDate,
        status: "closed",
        closing_reason: "Historical import",
      })
      .select("id")
      .single();

    if (error || !created) {
      throw new Error(`ImportService.findOrCreateHistoricalBusinessDay: ${error?.message}`);
    }

    return created.id;
  }

  private async recomputeBusinessDayAggregates(businessDayId: string): Promise<void> {
    // Excludes 'corrected' too -- see AnalyticsService.getAnalytics's
    // own comment on this exact filter.
    const { data: sales } = await this.supabase
      .from("sales")
      .select("actual_amount")
      .eq("business_day_id", businessDayId)
      .neq("status", "voided")
      .neq("status", "corrected");

    const grossSales = (sales ?? []).reduce((sum, s) => sum + Number(s.actual_amount), 0);
    const transactionCount = sales?.length ?? 0;

    await this.supabase
      .from("business_days")
      .update({ aggregates: { grossSales, transactionCount } })
      .eq("id", businessDayId);
  }

  private async buildLookupContext(tenantId: string, uploadedBy: string): Promise<ImportLookupContext> {
    const [{ data: products }, { data: locations }, members, { data: primaryLocation }] = await Promise.all([
      this.supabase.from("products").select("id, name, sku, image_url, expected_price").eq("tenant_id", tenantId),
      this.supabase.from("locations").select("id, name").eq("tenant_id", tenantId),
      this.listSalesCapturePeople(tenantId),
      this.supabase
        .from("locations")
        .select("id")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    return {
      products: (products ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        imageUrl: p.image_url,
        expectedPrice: p.expected_price,
      })),
      locations: locations ?? [],
      // Scoped to sales.create holders (same set the template's own
      // dropdown offers) -- see listSalesCapturePeople's header comment
      // for the fallback when no one currently holds it.
      members,
      defaultLocationId: primaryLocation?.id ?? "",
      uploadedBy,
      todayYmd: new Date().toISOString().slice(0, 10),
    };
  }

  private async buildProductLookupContext(tenantId: string): Promise<ProductImportLookupContext> {
    const { data: products } = await this.supabase.from("products").select("sku").eq("tenant_id", tenantId);

    return {
      existingSkus: new Set((products ?? []).flatMap((p) => (p.sku ? [p.sku.toLowerCase()] : []))),
    };
  }
}

async function parseWorksheet(buffer: Buffer, fileName: string): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();

  if (fileName.toLowerCase().endsWith(".csv")) {
    await workbook.csv.read(Readable.from(buffer));
  } else {
    // exceljs's bundled Buffer type predates Node 22's resizable-
    // ArrayBuffer Buffer additions, so it structurally rejects our
    // @types/node Buffer here even though the runtime value is exactly
    // what xlsx.load() expects -- a type-declaration mismatch, not a
    // real one.
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("No worksheet found in the uploaded file");
  }
  return worksheet;
}

function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === "23505";
}

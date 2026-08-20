# 12 — Imports & Data Migration

## Purpose

Businesses moving off spreadsheets need a safe path to bring historical sales (and product catalogs) into the platform without corrupting live data. Critical for onboarding (spec §46).

## Workflow

```
Download Template -> Populate Data -> Upload -> Validation -> Preview
  -> Resolve Errors -> Confirm Import -> Analytics Rebuild
```

`imports` tracks the batch (`type`: sales_history | products; `status`; `file_storage_path`; `uploaded_by`; row counts). `import_rows` tracks each row's outcome (`raw_data`, `status`: valid/invalid/imported/skipped, `errors`, `resolved_data`, `created_entity_id`).

## Historical sales template

| Column | Required |
|---|---|
| Sale Date | Yes |
| Sale Time | Optional |
| Product Name | Yes |
| Amount | Yes |
| Quantity | Optional |
| Sales Person | Yes |
| Location | Optional |
| Existing Reference | Optional |
| Notes | Optional |

Product Name and Sales Person are real Excel dropdowns in the generated template (a hidden "Lists" sheet, tenant-specific: this tenant's own active products, and members holding `sales.create`) — picking from the list is how exact-match validation stays reliable, which is also why the old separate "Product Code"/SKU column was dropped rather than kept alongside it. Required columns' header cells are filled a distinct color in the generated file itself, not just called out in the Instructions sheet.

## Validation rules (before import)

Invalid dates, unknown products, missing amount, incorrect numeric formats, duplicate transaction references, invalid users, invalid locations, negative amounts, unsupported date ranges. Every rejected row carries a specific, per-row reason — never a generic "row 42 failed."

## Import result & audit

```
2,500 Rows Uploaded
2,431 Valid
69 Require Attention
```

`imports` doubles as the audit record: Import ID, File Name, Uploader, Timestamp, Rows Submitted/Accepted/Rejected, Errors, Status.

## Post-import

Confirmed rows create real `sales` rows (going through the same `SalesService` insert path as live-captured sales — no separate, less-validated write path) attributed to their historical `sale_date`/`sale_time`, then trigger an analytics rebuild for the affected date range so aggregates/`insights_snapshots` reflect the newly imported history.

## Products bulk upload

Same shape (`ImportService` with `type = 'products'`): Download Template → Upload → Validate → Preview → Import. See `10-products.md`.

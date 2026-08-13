# 03 — Database Schema

Convention: every **tenant-scoped** table carries a non-nullable `tenant_id uuid references tenants(id)`. Global/catalog tables and cross-tenant platform tables are marked explicitly. Full SQL lives in `supabase/migrations/`; this is the map, not the source of truth for exact column types.

## Identity chain

```
auth.users (Supabase-managed)
      |
profiles              -- global identity, one row per human, not tenant-scoped
      |
tenant_memberships     -- many-to-many: one person can belong to several tenants
      |
tenants
```

Never attach application data directly to `auth.users`. This indirection is what lets one person belong to multiple businesses (per spec §104).

## 3.1 Tenancy & Identity

| Table | Key columns | Scope |
|---|---|---|
| `profiles` | `id` (= `auth.users.id`), `full_name`, `avatar_url`, `email`, `phone`, `default_locale` | Global |
| `tenants` | `id`, `name`, `slug` (unique), `status` (active/suspended/cancelled), `timezone`, `default_locale`, `currency`, `billing_owner_profile_id` → profiles, `anniversary_date` | Root |
| `tenant_memberships` | `id`, `tenant_id`, `profile_id`, `status` (active/invited/disabled), `invited_by`, `joined_at` — unique(`tenant_id`,`profile_id`) | Tenant |
| `tenant_settings` | `tenant_id`, `setting_key`, `value jsonb`, `updated_by` | Tenant |
| `locations` | `id`, `tenant_id`, `name`, `code`, `address`, `lat`, `long`, `geofence_radius_m`, `timezone` (nullable override), `status` | Tenant |
| `location_hours` | `id`, `tenant_id`, `location_id`, `day_of_week`, `open_time`, `close_time` | Tenant |
| `special_hours` | `id`, `tenant_id`, `location_id`, `date`, `is_closed`, `open_time`, `close_time`, `reason` | Tenant |

## 3.2 RBAC

| Table | Key columns | Scope |
|---|---|---|
| `permissions` | `id`, `key` (unique, e.g. `sales.create`), `description`, `category` | Global catalog |
| `roles` | `id`, `tenant_id`, `name`, `description`, `is_system_default` | Tenant — default roles are seeded as **per-tenant rows** at tenant creation, not shared templates, so a tenant can freely edit its own grants |
| `role_permissions` | `role_id`, `permission_id` (composite PK) | Tenant (via role) |
| `user_role_assignments` | `id`, `tenant_membership_id`, `role_id`, `location_id` (nullable — scopes a role to one location), `assigned_by`, `assigned_at` | Tenant (via membership) |

See `06-roles-permissions.md` for the full seed permission catalog and default-role grants.

## 3.3 Sales & Catalog

| Table | Key columns | Scope |
|---|---|---|
| `products` | `id`, `tenant_id`, `location_id` (nullable), `sku`, `name`, `description`, `expected_price`, `show_expected_price`, `image_url`, `display_order`, `status` (active/inactive/archived), `created_by` | Tenant |
| `product_images` | `id`, `tenant_id`, `product_id`, `storage_path`, `width`, `height`, `is_primary` | Tenant |
| `business_days` | `id`, `tenant_id`, `location_id`, `business_date`, `status` (scheduled/open/closing/closed/reopened), `opened_at/by`, `closed_at/by`, `scheduled_open_time`, `scheduled_close_time`, `reopen_expires_at`, `opening_reason`, `closing_reason`, `reopened_at/by`, `aggregates jsonb` — unique(`tenant_id`,`location_id`,`business_date`) | Tenant |
| `sales` | `id`, `tenant_id`, `location_id`, `business_day_id`, `product_id`, `sale_number`, `barcode_reference`, `product_name_snapshot`, `product_image_snapshot`, `expected_price_snapshot`, `actual_amount`, `quantity` (nullable), `recorded_by`, `sale_date`, `sale_time`, `status` (open/locked/corrected/voided), `idempotency_key` — unique(`tenant_id`,`idempotency_key`) | Tenant — highest index load in the schema |
| `sale_corrections` | `id`, `tenant_id`, `sale_id`, `correction_type` (void/correct/reverse), `old_values jsonb`, `new_values jsonb`, `reason`, `requested_by`, `approved_by` (nullable), `approval_request_id` | Tenant |
| `sale_number_sequences` | `tenant_id`, `location_id` (nullable), `scope_key`, `year`, `current_value` | Tenant |

**Indexes** (per spec §115): `tenant_id`, `sale_date`, `product_id`, `recorded_by`, `business_day_id`, `location_id`, `created_at` on `sales`; composites `(tenant_id, sale_date)`, `(tenant_id, product_id, sale_date)`, `(tenant_id, recorded_by, sale_date)`. Hard uniqueness constraints: `(tenant_id, location_id, business_date)` on `business_days`, `(tenant_id, idempotency_key)` on `sales`.

## 3.4 Analytics & Reports

| Table | Key columns | Scope |
|---|---|---|
| `reports` | `id`, `tenant_id`, `location_id` (nullable), `report_type` (daily/weekly/monthly/custom), `period_start/end`, `status`, `storage_path`, `payload jsonb` | Tenant |
| `report_jobs` | `id`, `tenant_id`, `report_id` (nullable), `job_type`, `scheduled_for`, `status` (pending/running/completed/failed), `attempts`, `last_error` | Tenant — doubles as the outbox for scheduled-job side effects, see `09-business-day-engine.md` |
| `insights_snapshots` | `id`, `tenant_id`, `location_id`, `business_day_id` (nullable), `rule_key`, `severity`, `message`, `data jsonb`, `generated_at` | Tenant |

## 3.5 Imports

| Table | Key columns | Scope |
|---|---|---|
| `imports` | `id`, `tenant_id`, `type` (sales_history/products), `status`, `file_storage_path`, `uploaded_by`, `total/valid/error_rows` | Tenant |
| `import_rows` | `id`, `tenant_id`, `import_id`, `row_number`, `raw_data jsonb`, `status` (valid/invalid/imported/skipped), `errors jsonb`, `resolved_data jsonb`, `created_entity_id` (nullable) | Tenant |

## 3.6 Notifications

| Table | Key columns | Scope |
|---|---|---|
| `notifications` | `id`, `tenant_id` (nullable — null = platform broadcast), `profile_id`, `type`, `title`, `body`, `data jsonb`, `read_at` | Mostly tenant |
| `notification_preferences` | `id`, `tenant_id`, `profile_id`, `channel` (email/push/inapp), `category`, `enabled` | Tenant |

## 3.7 Security & Audit

| Table | Key columns | Scope |
|---|---|---|
| `login_events` | `id`, `tenant_id` (nullable), `profile_id`, `ip`, `device`, `browser`, `os`, `success`, `failure_reason`, `created_at` | Nullable (pre-tenant-context events) |
| `sessions` | `id`, `profile_id`, `tenant_id` (nullable), `device_fingerprint`, `ip`, `user_agent`, `last_seen_at`, `revoked_at/by/reason` | Nullable |
| `temporary_access_requests` | `id`, `tenant_id`, `profile_id`, `location_id`, `reason`, `status`, `approval_request_id`, `granted_from/until` | Tenant |
| `audit_logs` | `id`, `tenant_id` (nullable — null = platform action), `actor_profile_id` (nullable — system actor), `action`, `entity_type`, `entity_id`, `old_values jsonb`, `new_values jsonb`, `reason`, `ip`, `device`, `metadata jsonb`, `created_at` | Mostly tenant, append-only |
| `approval_requests` | `id`, `tenant_id`, `type`, `requested_by`, `request_payload jsonb`, `status` (pending/approved/rejected/expired), `reviewed_by/at`, `review_notes`, `resolution_payload jsonb`, `expires_at` | Tenant — generic approval engine, see `19-security-checklist.md` §5 |
| `download_audit` | `id`, `tenant_id`, `profile_id`, `export_type`, `entity_ref`, `passcode_verified_at`, `ip`, `created_at` | Tenant |

Audit-type tables get **no UPDATE/DELETE RLS policy at all** — with RLS enabled and no policy defined for those commands, Postgres denies them outright to every role, which is a stronger immutability guarantee than application discipline alone.

## 3.8 Billing

| Table | Key columns | Scope |
|---|---|---|
| `billing_plans` | `id`, `code`, `name`, `price`, `currency`, `interval`, `features jsonb` | Global catalog |
| `subscriptions` | `id`, `tenant_id` (unique), `plan_id`, `status` (TRIAL/ACTIVE/PAYMENT_DUE/GRACE_PERIOD/SUSPENDED/CANCELLED), `trial_end`, `current_period_start/end`, `next_billing_date`, `grace_period_end`, `paystack_customer_code`, `paystack_subscription_code` | Tenant |
| `payments` | `id`, `tenant_id`, `subscription_id`, `amount`, `currency`, `status`, `paystack_reference` (unique), `paid_at`, `raw_payload jsonb` | Tenant |
| `billing_events` | `id`, `tenant_id` (nullable), `subscription_id` (nullable), `event_type`, `paystack_event_id` (unique), `payload jsonb`, `processed_at` | Webhook idempotency ledger |

Writable only via the Paystack webhook route running under the service-role client — no client-authenticated path ever writes `subscriptions`/`payments` directly.

## 3.9 Platform Admin

| Table | Key columns | Scope |
|---|---|---|
| `platform_admins` | `id`, `profile_id` (unique), `role` (super_admin/support/billing_ops) | Global |
| `platform_audit_logs` | `id`, `platform_admin_id`, `action`, `target_tenant_id` (nullable), `target_profile_id` (nullable), `old/new_values jsonb`, `reason`, `ip`, `created_at` | Cross-tenant |
| `impersonation_sessions` | `id`, `platform_admin_id`, `target_tenant_id`, `target_profile_id`, `reason`, `mfa_verified_at`, `started_at`, `expires_at`, `ended_at`, `banner_ack` | Cross-tenant |
| `anniversary_wishes` | `id`, `tenant_id`, `year`, `mode` (automatic/review/disabled), `status`, `scheduled_for`, `sent_at`, `message` | Tenant |

Platform-admin tables are **not reachable through the normal authenticated RLS surface at all** — access only via the service-role client after an app-layer `is_platform_admin()` check. A compromised tenant session can never enumerate them. See `15-super-admin.md`.

## Row Level Security pattern

Every tenant-scoped table's policy resolves to one shape:

```
USING ( has_permission(tenant_id, '<relevant.permission>') )
```

`has_permission(tenant_id, permission_key, location_id default null)` and `is_tenant_member(tenant_id)` are `SECURITY DEFINER` Postgres functions with pinned `search_path` and restricted `EXECUTE` grants (`authenticated` only). **Every** policy — including the one on `tenant_memberships` itself — calls these functions rather than querying membership/role tables inline. This avoids RLS self-recursion (a policy on `tenant_memberships` that queries `tenant_memberships` to authorize itself) and the row-by-row performance collapse that comes with it. Full rationale in `04-multi-tenancy.md`.

`has_permission()` also takes `tenants.status` into account so suspension enforcement is centralized in one function rather than re-derived per feature.

**Discipline rule that RLS does not enforce for you**: because membership is many-to-many, RLS proves "this user can access rows of tenant X" — it does not know which tenant is "active" for a multi-tenant user's current session. Every service method must still explicitly filter `WHERE tenant_id = :activeTenantId`. This is a mandatory code-review checklist item (`18-testing-qa.md`), not something the database solves for you.

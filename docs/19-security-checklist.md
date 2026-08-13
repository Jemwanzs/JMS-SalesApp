# 19 — Security Checklist & Decision Log

## Security baseline (tracked, not aspirational)

| Item | Status | Where |
|---|---|---|
| Supabase RLS on every tenant-scoped table | Planned, Phase 1b | `04-multi-tenancy.md` |
| Server-side permission checks (not frontend-only) | Planned, Phase 1e | `06-roles-permissions.md` |
| MFA for privileged operations (reopen, impersonation) | Planned, Phase 4d / 7b | `05-authentication-security.md` |
| Secure sessions, device/session revocation | Planned, Phase 4c | `05-authentication-security.md` |
| Signed/scoped storage access | Planned, Phase 2a | `10-products.md` |
| Rate limiting | Planned, Phase 1c (auth endpoints) | — |
| Audit trails, immutable by construction | Planned, Phase 1b (schema), rolled out per feature | `03-database-schema.md` |
| Secret management (no plaintext, nothing committed) | In place, Phase 1a | `.env.example`, `17-devops-deployment.md` |
| Environment separation (dev/preview/prod) | Planned, Phase 1a/6 | `17-devops-deployment.md` |
| Input validation (Zod, shared client/server) | Planned, ongoing | `16-api-services.md` |
| Database constraints (uniqueness, FKs) | Planned, Phase 1b+ | `03-database-schema.md` |
| Webhook signature verification (Paystack) | Planned, Phase 6c | `14-billing-paystack.md` |
| CSP / security headers | Planned, Phase 1a follow-up | — |
| Log redaction (no secrets in audit metadata) | Planned, Phase 1b+ | `05-authentication-security.md` |

## Decisions resolved during architecture planning

The scope document is the primary source of truth; where it left a technical or business decision open (or contained an internal tension), it was resolved here rather than silently guessed at during implementation.

1. **Free trial length.** Spec says 1 day (§11); an unusually short window for a B2B onboarding flow that includes staff invites and product setup. **Resolved with the client: default 7 days**, fully configurable (tenant + global), original figure preserved here for traceability. See `14-billing-paystack.md`.

2. **RLS recursion risk.** A policy on `tenant_memberships` that queries `tenant_memberships` to authorize itself recurses and degrades badly under row-by-row RLS evaluation. **Resolved**: all membership/permission checks route through `SECURITY DEFINER` functions with pinned `search_path` (an unpinned `search_path` in a `SECURITY DEFINER` function is itself a known Postgres privilege-escalation vector — pinning it is mandatory, not optional). See `04-multi-tenancy.md`. This is the top acceptance criterion for the Phase 1b migration.

3. **Geo-fencing "graceful fallback when location unavailable."** Spec says handle it gracefully without defining what that means. **Resolved**: on denied/unavailable geolocation, auto-route into the existing temporary-access-request/approval flow rather than silent-allow (security hole) or a dead-end hard block (support burden). See `05-authentication-security.md`.

4. **RLS proves access, not active-tenant scoping.** Because tenant membership is many-to-many, a query without an explicit `tenant_id` filter could, under RLS alone, return rows from every tenant a user belongs to. **Resolved**: documented as a mandatory code-review checklist item — every `services/*` method must explicitly filter by the caller's currently-selected tenant. Not solvable by RLS alone; a discipline rule, not a bug fix. See `04-multi-tenancy.md`.

5. **Snapshot fields vs. current-catalog analytics labeling.** `sales.product_name_snapshot` intentionally never retroacts on a product rename, but aggregate analytics grouped by `product_id` implicitly use the *current* name. **Resolved**: not a bug, documented per-report in `AnalyticsService` so a label mismatch against a drill-down row isn't mistaken for a defect. See `08-sales-engine.md`.

6. **Suspended-tenant read/write split.** "Billing owner keeps login + historical read, loses new sales/edits/exports/user admin" needs to be a single, centrally-enforced rule, not re-derived per feature. **Resolved**: `has_permission()` takes `tenants.status` as a parameter. See `04-multi-tenancy.md`.

7. **"No hardcoded roles" vs. a single accountable billing owner.** Billing/legal accountability isn't a role-permission concept — it's a 1:1 organizational fact. **Resolved**: `tenants.billing_owner_profile_id` is a dedicated FK, separate from RBAC. See `06-roles-permissions.md`.

8. **Idempotency key reuse.** `unique(tenant_id, idempotency_key)` with no expiry means a client bug reusing a UUID across distinct sale intents would silently dedupe them. **Resolved**: this is a client-side implementation discipline requirement (generate fresh per form mount, never reuse), not something the server can distinguish once it commits to idempotent-replay semantics. See `08-sales-engine.md`.

9. **Platform-admin password-visibility boundary.** Easy to satisfy, easy to accidentally violate (a future "just get one more field" query against `auth.*`). **Resolved**: hard rule — `PlatformAdminService` never reads `auth.*` tables directly; only `supabase.auth.admin.*` SDK calls under service-role for reset/disable. See `15-super-admin.md`.

10. **Composable access restrictions stacking confusing errors.** Working-hours + geo-fence + suspension + edit-window can all independently want to block the same action. **Resolved**: a single access-gate composition point in `AuthService`/`SecurityService` evaluates all restrictions together and returns one prioritized, user-legible reason. See `05-authentication-security.md`.

11. **`actual_amount`: total vs. unit price.** Spec doesn't resolve this given optional `quantity`. **Resolved**: `actual_amount` is always the total charged; quantity is informational; per-unit figures are derived in analytics only. See `08-sales-engine.md`.

12. **Multi-currency across locations.** `tenants.currency` is singular despite day-one multi-location support. **Resolved**: explicitly out of scope for now (tenant-level currency only), flagged for a future decision before multi-location rollout expands, not silently permanent. See `14-billing-paystack.md`.

## Non-negotiables (from the client's original scope, restated so they can't be missed)

- Never store retrievable plaintext passwords, ever.
- "Super Admin can see username and password" is a feature that must **never** exist.
- Impersonation is **always** logged — no configuration disables the platform's own audit of it.
- Financial records are never physically deleted — VOID/CORRECT/REVERSE only.
- Business rules for closing days, editing historical sales, tenant isolation, permission enforcement, billing, and exports are enforced server-side / in Postgres — never frontend-only.

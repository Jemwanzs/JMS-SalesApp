# 01 — Development Roadmap

Granular, dependency-ordered build sequence. Each milestone should be independently completable and testable before the next one heavily depends on it. Status is tracked per-milestone in `20-development-progress.md` — this file defines *what* the milestones are; that file tracks *where we are*.

## Phase 1 — Foundation

| # | Milestone | Depends on |
|---|---|---|
| 1a | Repo/tooling scaffold: Next.js + TS strict, Tailwind, shadcn/ui, ESLint/Prettier, `.gitignore`, GitHub repo connected, branch structure | — |
| 1b | Core tenancy + RBAC migration: `profiles`, `tenants`, `tenant_memberships`, `tenant_settings`, `locations`, `location_hours`, `special_hours`, `permissions`, `roles`, `role_permissions`, `user_role_assignments`; `is_tenant_member`/`has_permission` SECURITY DEFINER functions; baseline RLS | 1a |
| 1c | Supabase Auth wiring: signup, login, email verify, password reset, `@supabase/ssr` cookie handling, profile auto-provision trigger | 1b |
| 1d | Tenant onboarding wizard (business details → hours → products → import → invite users → subscription → finish) | 1c |
| 1e | `can()` permission library + request-scoped cache + `TenantProvider`/`usePermission`/`useTenant` | 1b, 1c |
| 1f | Mobile-first app shell + PWA manifest/service worker + next-intl scaffold + distinct tenant vs platform-admin nav shells | 1c |
| 1g | Platform admin foundation: `platform_admins` table, seed bootstrap admin, admin shell, `is_platform_admin` guard | 1b |

## Phase 2 — Sales Engine

products CRUD + image upload/ordering/status → business-day core (manual open/close + state machine) → sale numbering service → sales capture (idempotent, snapshot fields) → edit-window + `sale_corrections` → pg_cron auto-open/close sweep → approval engine v1 → business-day reopen (MFA/passcode + time-boxed) → sales history views.

## Phase 3 — Analytics & Reports

daily aggregate computation on close → KPI dashboard (permission-gated date filters) → product analytics → scheduled report generation (outbox + Resend) → rule-based deterministic insights engine → corrections/void reports.

## Phase 4 — Enterprise Controls

custom roles UI → users & invitations → security centre (`login_events`/`sessions`, device revocation) → MFA enrollment → working-hours login restriction → geo-fencing + temporary-access-request (reuses approval engine) → download security (hashed passcode + `download_audit`) → full `audit_logs` coverage pass across ~20 event types.

## Phase 5 — Data Migration

import template generation → CSV/XLSX validation engine → preview/resolve-errors UI → confirm/import → analytics rebuild trigger.

## Phase 6 — Billing (Paystack)

`billing_plans`/`subscriptions` schema + Paystack setup → checkout + trial state machine → webhook handler (sole state-transition authority, signature-verified, idempotency ledger) → grace period + suspension enforcement folded into `has_permission` → billing owner UI.

## Phase 7 — Platform Administration

tenant list/detail + suspend/reactivate/extend-trial/adjust-grace (all through `PlatformAdminService`, all audited) → impersonation ("Access Workspace": reason + MFA + bounded duration + visible banner) → platform usage analytics → business anniversary tracking + automated wishes.

---

## Sequencing rules

1. No phase starts in earnest until the phase(s) it depends on have passing tests for their critical paths — especially Phase 1b's RLS/tenant-isolation proof, which everything else is built on top of.
2. Every phase that touches money, security, or cross-tenant data gets its own explicit test pass before being considered done (see `18-testing-qa.md`).
3. Docs are updated in the same change as the feature, not after — `03-database-schema.md`, `06-roles-permissions.md`, etc. must stay accurate to the actual migrations/code, not to what was originally planned.

## Decisions locked in during planning (not silently changed later without a note here)

- Free trial default: **7 days**, configurable (spec's original figure was 1 day — judged too short for a B2B onboarding flow that includes product setup and staff invites; see `14-billing-paystack.md`).
- `actual_amount` on a sale is always the **total charged**, never a unit price; `quantity` is informational only.
- Geo-fencing "location unavailable" case routes into the existing temporary-access-request/approval flow rather than silently allowing or hard-blocking.
- Platform admin is modeled as a `platform_admins` table (supports multiple admins), never a hardcoded email check in application logic — the scope's named account (`jamosammy@gmail.com`) is only used as the one-time seed value.

See `19-security-checklist.md` for the full list of scope ambiguities/risks and how each was resolved.

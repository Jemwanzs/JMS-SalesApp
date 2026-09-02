# 00 — Project Overview

## What this is

**JMS Sales App** is a mobile-first, multi-tenant Sales Records & Analytics SaaS platform. Businesses ("tenants") record daily sales against a product catalog, close out "business days," and get analytics, reports, and plain-language insights.

Philosophy: **Capture Sales → Close the Day → Analyse Performance → Generate Insights → Make Better Decisions.**

Primary user journey — the entire product is optimized around making this as short as possible:

```
Login → Select Product → Enter Sale → Submit → Return to Sales Screen
```

## What this is NOT

This is a deliberate boundary, not an oversight. The product must **not** silently grow into:

- Purchasing / suppliers
- Full accounting or bookkeeping
- Payroll / HR
- CRM
- POS hardware integration

Architecture decisions should avoid *needlessly* blocking these as future directions, but none of them ship without an explicit product decision to add them.

Inventory / stock management was on this list until the Product Enhancements batch — that explicit product decision has now been made, and it ships as an **optional, separately-billed add-on module** (never bundled into the base Sales product, never required to use it). See `21-inventory-management.md`. The rest of this list stays exactly as it was.

## Who uses it

- **Sales User** — captures sales, sees only their own activity.
- **Supervisor** — captures sales, sees team-level sales/analytics, limited corrections.
- **Tenant Administrator** — full control of one business: products, users, roles, settings, security, billing.
- **Custom roles** — tenants can define their own (Cashier, Auditor, Finance Manager, etc.) with individually chosen permissions.
- **Platform Super Admin** — operates the SaaS itself, entirely separate console, manages tenants/billing/support access across the whole platform.

## Source of truth

The original client scope document (157 sections, supplied as both a `.md` and a `.pdf`) is the primary source of truth for product requirements. This `/docs` suite is the working technical translation of that scope — kept in sync as implementation proceeds. Where a technical decision was left open in the scope, it was resolved here with a documented rationale (see `19-security-checklist.md` and `01-development-roadmap.md` for the list of such decisions).

## Core design commitments

1. **Mobile-first, always.** Max application width ~430–480px, centred, even on desktop. See `07-ui-ux-screen-map.md`.
2. **True multi-tenant SaaS.** Every tenant-owned row carries `tenant_id`; Postgres Row Level Security enforces isolation at the database layer, backed by server-side authorization — never frontend-only checks. See `04-multi-tenancy.md`.
3. **Permission-driven, not role-name-driven.** Code asks "does this user have `sales.void`?", never "is this user an Admin?". See `06-roles-permissions.md`.
4. **Nothing financial is ever hard-deleted.** Sales, corrections, audit logs, payments use status transitions (VOID/CORRECT/REVERSE, active/inactive/archived) — never `DELETE`. See `08-sales-engine.md`.
5. **Server-side enforcement for anything sensitive.** Closing sales days, editing historical sales, tenant isolation, permission checks, billing, exports — all enforced server-side / in Postgres, never trusted from the client. See `19-security-checklist.md`.

## Tech stack

Next.js (App Router) + React + TypeScript, Tailwind CSS + shadcn/ui, React Hook Form + Zod, TanStack Query, Recharts, next-intl, date-fns, PWA. Backend: Supabase (Postgres, Auth, RLS, Storage). Payments: Paystack. Email: Resend. Monitoring: Sentry. Hosting: Vercel. Full rationale in `02-system-architecture.md`.

## Documentation map

| File | Covers |
|---|---|
| `01-development-roadmap.md` | Phased build plan, status tracking |
| `02-system-architecture.md` | Architecture, request flow, service layer |
| `03-database-schema.md` | Full table catalog, relationships, indexes |
| `04-multi-tenancy.md` | Membership model, RLS strategy |
| `05-authentication-security.md` | Auth flows, MFA, sessions, geo-fencing |
| `06-roles-permissions.md` | RBAC, permission catalog, `can()` |
| `07-ui-ux-screen-map.md` | Navigation, screens, mobile shell |
| `08-sales-engine.md` | Sale record, numbering, idempotency, corrections |
| `09-business-day-engine.md` | State machine, timezones, scheduled jobs |
| `10-products.md` | Product schema, images, bulk upload |
| `11-analytics-reports.md` | KPIs, insights engine, scheduled reports |
| `12-imports-data-migration.md` | Historical sales import workflow |
| `13-notifications.md` | Channels, categories, outbox pattern |
| `14-billing-paystack.md` | Subscription states, webhooks, grace/suspension |
| `15-super-admin.md` | Platform console, impersonation |
| `16-api-services.md` | Service layer, folder structure |
| `17-devops-deployment.md` | Environments, branches, CI/CD |
| `18-testing-qa.md` | Test strategy incl. tenant-isolation tests |
| `19-security-checklist.md` | Security baseline + open-decision log |
| `20-development-progress.md` | Living progress tracker |
| `21-inventory-management.md` | Optional Inventory add-on: schema, entitlement, reconciliation, permissions |
| `22-hardening-roadmap.md` | Living platform-health hardening tracker (security/performance/completeness) |
| `23-data-maintenance-scripts.md` | One-off operational SQL scripts (Studio SQL Editor, not migrations) |
| `24-multi-branch-access.md` | Multi-Branch User Access: one tenant per profile, branch assignment, session-pinned active branch, RLS enforcement |
| `25-demo-video-generation.md` | Repeatable Playwright + ffmpeg pipeline generating the Login page's downloadable Sales Agent demo video |

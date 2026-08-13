# 02 — System Architecture

## High-level flow

```
Mobile-First PWA
      |
Next.js App Router (Server + Client Components)
      |
Server Actions / Route Handlers   <-- thin, validate + delegate only
      |
services/*  (framework-agnostic business logic)
      |
Supabase client (browser | server | service-role)
      |
Postgres: RLS policies + SECURITY DEFINER permission functions
      |
Storage / pg_cron / Auth
```

External integrations sit alongside, never in the request's critical path for state changes:

```
Paystack --webhook--> app/api/webhooks/paystack --> BillingService --> subscriptions/payments
pg_cron sweep --writes outbox--> report_jobs / notifications --drained by--> app/api/cron/outbox --> Resend / push
```

## Why this stack

- **Next.js App Router** — server components for data-heavy dashboard/reporting pages (no client-side waterfall), server actions for mutations co-located with the UI that triggers them, route handlers for webhooks/cron where a non-React response format or raw body access is required.
- **Supabase (Postgres + Auth + RLS + Storage)** — a single system provides the database, auth, tenant-isolation enforcement, and file storage, which keeps the "everything server-side, never trust the frontend" rule (see `19-security-checklist.md`) enforceable at the database layer rather than only in application code.
- **TanStack Query** — client-side cache for data fetched via server actions/RPCs where optimistic UI or polling (e.g. business-day countdown, notification bell) is needed; server components handle the initial-load path so TanStack Query is not doing double duty as the primary data layer.
- **Zod + React Hook Form** — one validation schema per domain object in `validations/`, shared between the client form resolver and the server action's input parsing, so client and server can never validate differently.

## Layering rule (the one rule that keeps this maintainable)

**Server actions and route handlers never call Supabase directly.** They:
1. Parse/validate input with a Zod schema from `validations/`.
2. Resolve auth/tenant context (current user, active tenant, permissions).
3. Delegate to a `services/*` function.

`services/*` is framework-agnostic — no Next.js-specific imports — so the same `SalesService.recordSale()` is callable from a server action, a cron route, or (if ever needed) a background worker, without duplicating business logic. See `16-api-services.md` for the full service catalog.

## Supabase client variants

Three distinct client constructors live in `lib/supabase/`, and mixing them up is the single easiest way to introduce a security bug:

| File | Key used | Respects RLS? | Allowed callers |
|---|---|---|---|
| `client.ts` | anon key | Yes | Client components only |
| `server.ts` | anon key + user's JWT (from request cookies) | Yes | Server components, server actions, route handlers acting on behalf of a signed-in user |
| `service-role.ts` | service-role key | **No — bypasses RLS entirely** | Paystack webhook handler, cron outbox drainer, `PlatformAdminService`, `ApprovalService` auto-approval writes. Never imported into any client-reachable code path. |

## Folder structure

```
app/
  (marketing)/                       public site
  (auth)/                            login, signup, verify-email, reset-password, invite/[token]
  (tenant)/t/[tenantSlug]/
    layout.tsx                       resolves slug -> tenant, enforces active membership
    (dashboard)/{sales,products,analytics,reports,users,security,billing,settings}/
  (platform-admin)/admin/
    layout.tsx                       separate shell, is_platform_admin guard
    {tenants,impersonation,analytics,billing-ops}/
  api/
    webhooks/paystack/route.ts       signature verification, raw body
    cron/outbox/route.ts             polled by Vercel Cron, drains report_jobs/notifications

components/                          shadcn/ui-based, presentational only
components/ui/                       shadcn primitives (generated, lightly customized)
components/shared/                   cross-feature composites (e.g. EmptyState, ConfirmDialog)

features/{auth,sales,products,analytics,reports,users,security,billing,platform-admin}/
  components/                        feature-specific UI
  actions/                           'use server' — thin, see layering rule above
  hooks/                             TanStack Query wrappers around actions

lib/
  supabase/{client.ts,server.ts,service-role.ts}
  permissions/can.ts                 calls has_permission/get_my_permissions RPC, request-scoped cache
  config-cascade/                    resolveSetting(tenantId, locationId, userId, key)
  utils.ts                           shadcn's cn() helper
  utils/                             date/currency/formatting helpers

services/                            AuthService, TenantService, UserService, RoleService,
                                      PermissionService, ProductService, SalesService,
                                      BusinessDayService, AnalyticsService, ReportService,
                                      ImportService, NotificationService, SecurityService,
                                      BillingService, AuditService, PlatformAdminService,
                                      ApprovalService

hooks/                               cross-cutting: useTenant, usePermission, useBusinessDay
types/                               database.types.ts (generated) + domain types
validations/                         zod schemas, shared by RHF resolvers and server actions

supabase/
  migrations/                        numbered, sequential, never edited after merge
  seeds/                             permission catalog, billing_plans, default role templates
  functions/                         edge functions, only where unavoidable (see 09-business-day-engine.md)

public/
tests/{unit,pgtap,e2e}/
docs/
```

## Request-scoped context

Every server action/route handler that acts within a tenant resolves a small context object once:

```ts
{ userId, activeTenantId, membership, permissionsVersion }
```

`lib/permissions/can.ts` wraps the permission-resolving RPC in React's `cache()` so this resolves once per request regardless of how many `can()` checks happen downstream. See `06-roles-permissions.md` for the full caching/invalidation strategy.

## Environments

| Environment | Purpose | Supabase project | Vercel |
|---|---|---|---|
| Development | Local dev (`npm run dev`) | Dev/shared Supabase project, own `.env.local` | — |
| Preview | Per-PR Vercel preview deployments | Same dev Supabase project (or a preview branch DB if using Supabase branching) | Automatic on PR |
| Production | Live app | Production Supabase project, separate credentials | `main` branch only |

Full details in `17-devops-deployment.md`.

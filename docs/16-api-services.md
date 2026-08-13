# 16 — API / Service Layer

## The layering rule

Server actions and route handlers are thin. They validate input (Zod, from `validations/`), resolve auth/tenant context, and delegate to `services/*`. **They never call Supabase directly.** This keeps business logic reachable from cron jobs and webhooks too, not just from React server actions — a cron sweep and a user-triggered action that both need to "close a business day" call the exact same `BusinessDayService.closeDay()`, not two parallel implementations.

```
UI / Server Action / Route Handler / Cron Job / Webhook
                    |
              services/*.ts   (framework-agnostic, no Next.js imports)
                    |
         lib/supabase/{server,service-role}.ts
```

## Service catalog

| Service | Owns |
|---|---|
| `AuthService` | Sign up/in/out, email verification, password reset, MFA, access-gate composition (working-hours + geo-fence + suspension combined) |
| `TenantService` | Tenant creation/onboarding, settings, config cascade resolution |
| `UserService` | Invitations, activation, active/inactive toggle |
| `RoleService` | Role CRUD, default-role seeding at tenant creation |
| `PermissionService` | Permission catalog access, `get_my_permissions` wrapper |
| `ProductService` | CRUD, image handling, display order, bulk upload |
| `SalesService` | Sale numbering, idempotent insert, edit-window enforcement, void/correct/reverse |
| `BusinessDayService` | Open/close/reopen state machine, aggregate computation |
| `AnalyticsService` | KPI queries, date-range analytics, snapshot-vs-current labeling |
| `ReportService` | Scheduled report generation, corrections/void reports |
| `ImportService` | Template generation, validation, preview, confirm-import (sales + products) |
| `NotificationService` | In-app notification writes, outbox entries, preferences |
| `SecurityService` | Sessions/devices, geo-fencing, working-hours restriction, download passcode, temporary access |
| `BillingService` | Subscription state transitions, Paystack webhook processing |
| `AuditService` | `audit_logs` writes — called by every other service on any sensitive mutation, never optional |
| `PlatformAdminService` | Tenant management, impersonation, platform analytics — service-role only |
| `ApprovalService` | Generic approval-request lifecycle + per-feature handler dispatch (see `19-security-checklist.md` §5) |

## Supabase client variants (recap — full detail in `02-system-architecture.md`)

`lib/supabase/client.ts` (browser, anon key, RLS-respecting) / `server.ts` (server, anon key + user JWT, RLS-respecting) / `service-role.ts` (server-only, bypasses RLS — webhooks, cron, `PlatformAdminService`, `ApprovalService` auto-approval writes only).

## Validation

One Zod schema per domain object in `validations/` (e.g. `validations/sale.ts`), imported by both the React Hook Form resolver on the client and the server action's input parsing — client and server can never validate a payload differently, because there is only one schema.

## Types

`types/database.types.ts` is generated from the live Supabase schema (`supabase gen types typescript`) and regenerated after every migration — never hand-edited. Domain types that add meaning beyond the raw table shape (e.g. a `SaleWithSnapshot` view type) live alongside it in `types/`.

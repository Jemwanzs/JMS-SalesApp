# 20 — Development Progress

Living tracker. Update this file in the same change as the work it describes — never mark something complete that wasn't actually implemented and at least minimally verified (see `18-testing-qa.md`'s "what done means").

## Phase 1 — Foundation

| # | Milestone | Status | Notes |
|---|---|---|---|
| 1a | Repo/tooling scaffold | **Done** | Next.js 15.5.23 (App Router, TS strict) + Tailwind v4 + shadcn/ui (`base-nova` style) + ESLint 9 (flat config via `FlatCompat`) + Prettier defaults. `npm run build` and `npm run lint` both pass clean. Full feature-based folder structure created per `02-system-architecture.md`. `.env.example` documents every required variable. Git initialized, `Jemwanzs/JMS-SalesApp` remote connected, `main`/`development` branches created, initial commit pushed. |
| 1b | Core tenancy + RBAC migration | **Written, not yet applied** | `supabase/migrations/0001_core_tenancy_and_rbac.sql` is complete: `profiles`, `tenants`, `tenant_memberships`, `tenant_settings`, `locations`, `location_hours`, `special_hours`, `permissions` (seeded), `roles`, `role_permissions`, `user_role_assignments`; `is_tenant_member`/`has_permission`/`get_my_permissions` SECURITY DEFINER functions; RLS enabled + policies on every table. **Not yet run against a live database** — blocked on Supabase project credentials (see Blockers below). pgTAP cross-tenant isolation tests (the top acceptance criterion per `18-testing-qa.md`) are not yet written — next action once the migration is applied. |
| 1c | Supabase Auth wiring | **Not started** | `lib/supabase/client.ts`, `server.ts`, `service-role.ts` are written and type-check cleanly against the provisional `types/database.types.ts`, but no sign-up/login/verify/reset UI or server actions exist yet. |
| 1d | Tenant onboarding wizard | **Not started** | `TenantService.createTenant` exists only as a documented stub (throws `not yet implemented`). |
| 1e | `can()` + permission hooks | **Library written, unexercised** | `lib/permissions/can.ts` implements `getMyPermissions` (React `cache()`-wrapped RPC call), `can()`, `assertCan()` — calls the same `get_my_permissions` SQL function RLS policies use, per the single-source-of-truth design in `06-roles-permissions.md`. Not yet used by any real route/action since none exist yet. No `usePermission`/`useTenant` client hooks yet. |
| 1f | Mobile-first app shell + PWA | **Not started** | Root layout exists with corrected metadata; no mobile-width shell constraint, PWA manifest, service worker, or next-intl wiring yet. |
| 1g | Platform admin foundation | **Not started** | `platform_admins` table, seed, admin shell, and `is_platform_admin()` guard are all pending — `PlatformAdminService.isPlatformAdmin` is a stub. |

## Phases 2–7

Not started. See `01-development-roadmap.md` for the full granular milestone breakdown.

## What actually exists right now

- Full Next.js 15.5.23 + TypeScript strict + Tailwind v4 + shadcn/ui scaffold, builds and lints clean.
- Complete `/docs` suite (this file plus 20 others) reflecting the architecture decisions made during planning.
- `supabase/migrations/0001_core_tenancy_and_rbac.sql` — schema + RLS + permission catalog seed, written but unapplied.
- `lib/supabase/{client,server,service-role}.ts` — the three-client security boundary, fully implemented.
- `lib/permissions/can.ts` — implemented against the migration's SQL functions.
- `types/database.types.ts` — hand-written, PROVISIONAL, matches migration 0001 exactly (including the `Relationships: []` field every table needs for Supabase's generic type inference to work — this was a real gotcha during setup, see below). Must be regenerated via `supabase gen types typescript` once the project is linked.
- 17 service stub files in `services/` — every service named in `16-api-services.md` exists as a typed, documented stub that throws `not yet implemented (Phase X)`. This makes the intended architecture visible and importable (for type-checking dependent code) before real implementation lands.

## Decisions made during setup (beyond the architecture-planning decisions logged in `19-security-checklist.md`)

- **Pinned Next.js to 15.5.23 instead of the `latest` tag (16.3.0).** `create-next-app@latest` pulled Next 16.3.0, whose own generated agent-notes explicitly warn of breaking changes from typical training data and instruct reading bundled docs before writing code. For a security-critical, long-lived foundation, stability and familiarity outweighed being on the newest release. Next 15 is still fully modern App Router/Server Actions/Server Components.
- **`npm audit` overrides for `postcss`/`sharp`.** Next 15.5.23 bundles vulnerable transitive versions of both; added `overrides` in `package.json` pinning safe versions without needing to move off Next 15. Audit is clean (0 vulnerabilities).
- **ESLint flat-config compatibility shim.** `eslint-config-next@15.5.23` ships legacy (non-flat) shareable configs; `create-next-app`'s generated `eslint.config.mjs` assumed the newer flat-config-native format. Fixed using the standard `@eslint/eslintrc` `FlatCompat` shim.
- **Hand-wrote `components/ui/form.tsx`.** The `shadcn` CLI's registry in this version doesn't ship a `form` block; hand-wrote the standard, well-established shadcn form-wrapper pattern (Controller/FormProvider context plumbing) rather than fighting the CLI.
- **`Relationships: []` gotcha in hand-written Supabase types.** Supabase's generic type system (`GenericTable`/`GenericSchema` in `@supabase/postgrest-js`) requires every table entry to declare a `Relationships` array for `.rpc()` argument type-checking to work at all — omitting it doesn't error loudly, it silently degrades every `.rpc()` call to an untyped fallback. Documented here so it isn't rediscovered the hard way later, and so nobody "simplifies" the provisional types file by removing it.

## Blockers

1. **Supabase project credentials not yet provided.** Migration 0001 cannot be applied to a real database, `types/database.types.ts` cannot be regenerated from the live schema, and no auth flow can be end-to-end tested until `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are supplied and placed in `.env.local` (gitignored, never committed). This is the single blocking dependency for continuing past Phase 1a into any real Phase 1b verification.

## Next recommended action

Once Supabase credentials are available: link the project, apply migration 0001, regenerate `types/database.types.ts` from the live schema (diff it against the hand-written provisional version to catch any drift), write the pgTAP cross-tenant isolation test suite, then proceed to Phase 1c (Supabase Auth wiring).

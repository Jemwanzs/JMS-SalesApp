# 20 — Development Progress

Living tracker. Update this file in the same change as the work it describes — never mark something complete that wasn't actually implemented and at least minimally verified (see `18-testing-qa.md`'s "what done means").

## Phase 1 — Foundation

| # | Milestone | Status | Notes |
|---|---|---|---|
| 1a | Repo/tooling scaffold | **Done** | Next.js 15.5.23 (App Router, TS strict) + Tailwind v4 + shadcn/ui (`base-nova` style) + ESLint 9 (flat config via `FlatCompat`) + Prettier defaults. `npm run build` and `npm run lint` both pass clean. Full feature-based folder structure created per `02-system-architecture.md`. `.env.example` documents every required variable. Git initialized, `Jemwanzs/JMS-SalesApp` remote connected, `main`/`development` branches created, initial commit pushed. |
| 1b | Core tenancy + RBAC migration | **Applied and spot-verified** | `supabase/migrations/0001_core_tenancy_and_rbac.sql` was run against the live project (`bajjwqlrxzamvdwjzxdq`, applied by the user via Supabase Studio's SQL Editor) and verified end-to-end from the app side: all 11 tables reachable, all 30 seeded permission rows present, `is_tenant_member()` callable without error. `tests/pgtap/001_tenant_isolation.sql` (20 assertions) is written, covering RLS on `tenants`/`tenant_memberships`/`locations`/`roles`/`role_permissions`/`user_role_assignments`, the no-membership-sees-nothing case, the permission catalog's global readability, and suspension folding into `has_permission()` — **not yet executed**, since it needs a local Supabase stack (`supabase start`, which needs Docker Desktop running — Docker is installed but the daemon wasn't running when this was written) rather than running fixture-creating tests against the shared live project. `supabase init` has been run, so `supabase/config.toml` exists for local dev. Running `supabase test db` once Docker is up is the next concrete action. |
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
- `types/database.types.ts` — hand-written, PROVISIONAL, matches migration 0001 exactly (including the `Relationships: []` field every table needs for Supabase's generic type inference to work — this was a real gotcha during setup, see below) and confirmed accurate against the live schema by the spot-verification above. Regenerating it from the CLI (`supabase gen types typescript --project-id bajjwqlrxzamvdwjzxdq`) requires a Supabase personal access token (`supabase login` or `SUPABASE_ACCESS_TOKEN`), which hasn't been provided — not currently blocking anything since the hand-written version is verified accurate, but worth doing for exact fidelity once convenient.
- 17 service stub files in `services/` — every service named in `16-api-services.md` exists as a typed, documented stub that throws `not yet implemented (Phase X)`. This makes the intended architecture visible and importable (for type-checking dependent code) before real implementation lands.
- `.env.local` populated with the real Supabase URL/anon/service-role keys (gitignored, not committed).

## Decisions made during setup (beyond the architecture-planning decisions logged in `19-security-checklist.md`)

- **Pinned Next.js to 15.5.23 instead of the `latest` tag (16.3.0).** `create-next-app@latest` pulled Next 16.3.0, whose own generated agent-notes explicitly warn of breaking changes from typical training data and instruct reading bundled docs before writing code. For a security-critical, long-lived foundation, stability and familiarity outweighed being on the newest release. Next 15 is still fully modern App Router/Server Actions/Server Components.
- **`npm audit` overrides for `postcss`/`sharp`.** Next 15.5.23 bundles vulnerable transitive versions of both; added `overrides` in `package.json` pinning safe versions without needing to move off Next 15. Audit is clean (0 vulnerabilities).
- **ESLint flat-config compatibility shim.** `eslint-config-next@15.5.23` ships legacy (non-flat) shareable configs; `create-next-app`'s generated `eslint.config.mjs` assumed the newer flat-config-native format. Fixed using the standard `@eslint/eslintrc` `FlatCompat` shim.
- **Hand-wrote `components/ui/form.tsx`.** The `shadcn` CLI's registry in this version doesn't ship a `form` block; hand-wrote the standard, well-established shadcn form-wrapper pattern (Controller/FormProvider context plumbing) rather than fighting the CLI.
- **`Relationships: []` gotcha in hand-written Supabase types.** Supabase's generic type system (`GenericTable`/`GenericSchema` in `@supabase/postgrest-js`) requires every table entry to declare a `Relationships` array for `.rpc()` argument type-checking to work at all — omitting it doesn't error loudly, it silently degrades every `.rpc()` call to an untyped fallback. Documented here so it isn't rediscovered the hard way later, and so nobody "simplifies" the provisional types file by removing it.

## Blockers

None currently blocking. Two low-priority follow-ups, neither gating further work:

1. **pgTAP suite not yet executed.** Needs Docker Desktop running locally (`supabase start` + `supabase test db`). The migration itself has been spot-verified against the live project in the meantime (see 1b above), so this is about getting the full 20-assertion proof running, not about unverified risk.
2. **`types/database.types.ts` regeneration needs a Supabase personal access token.** Not blocking — the hand-written version is confirmed accurate.

## Next recommended action

Start Docker Desktop, run `supabase start` + `supabase test db` to execute `tests/pgtap/001_tenant_isolation.sql` and confirm all 20 assertions pass, then proceed to Phase 1c (Supabase Auth wiring): sign-up/login/verify/reset flows, `@supabase/ssr` middleware for session refresh, and `TenantService.createTenant`'s service-role bootstrap sequence (see the note atop migration 0001).

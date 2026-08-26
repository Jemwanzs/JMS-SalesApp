# 22 — Hardening Roadmap

Living tracker for the platform-health audit (security/performance/global-completeness pass, 2026-08-27). Phases are ordered by **effort and dependency, not severity** — per explicit direction: quickest and simplest first, anything needing a new external account, a new webhook, or new server infrastructure pushed to the last phases. A Critical finding that needs a new paid tool can still land after a Low finding that's a five-line config change, if the config change is genuinely faster to ship safely.

Update this file in the same change as the work it describes — never mark something done that wasn't actually implemented and verified (same rule `20-development-progress.md` already holds itself to).

## Phase 1 — Zero-dependency hardening (config + code only, no new accounts/tools/webhooks)

Everything here ships with what the project already has: no new package, no new external account, no new infrastructure.

| # | Item | Status | Notes |
|---|---|---|---|
| 1.1 | CSP + security headers | **Done** | `next.config.ts` gained a `headers()` block: CSP (scoped to what the app actually loads — self, Google Fonts, Supabase Storage/Realtime, no Paystack allowance needed since checkout is a full top-level redirect, never embedded), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (geolocation allowed for self — the app's own geofencing feature needs it). |
| 1.2 | Exclude webhook/cron routes from middleware's session refresh | **Done** | `middleware.ts`'s matcher now excludes `api/webhooks` and `api/cron` — both authenticate themselves (HMAC signature, `CRON_SECRET` bearer) and never read the Supabase session; the other two `/api/*` routes (`api/auth/callback`, `api/t/[tenantSlug]/imports/template`) still need it and were left matched. |
| 1.3 | `CRON_SECRET` fails open if unset | **Done** | `app/api/cron/outbox/route.ts`'s new `isAuthorizedCronRequest()` rejects outright when the env var is falsy (previously `"Bearer undefined"` would have matched a literal request sending that string) and compares with `crypto.timingSafeEqual` after a length check, not `!==`. |
| 1.4 | Product images unoptimized | **Done** | `next.config.ts` now declares `images.remotePatterns` for the Supabase Storage host (read from `NEXT_PUBLIC_SUPABASE_URL` at config-eval time); `unoptimized` removed from both `product-photo-viewer.tsx` call sites and `product-image-upload.tsx` — all three only ever render a real Storage public URL, never a local blob preview, so this was safe to drop everywhere it appeared. |
| 1.5 | Cross-tenant role-assignment integrity | **Done, migration not yet applied** | `supabase/migrations/0039_role_assignment_tenant_integrity.sql` — a `BEFORE INSERT OR UPDATE` trigger on `user_role_assignments` rejecting any row whose `role_id` belongs to a different tenant than the assignment's own `tenant_id`. `has_permission()` itself was never touched (SQL functions in Postgres can't easily read updated function bodies mid-migration-review the way app code can be diffed, and this fix doesn't need to touch it — the trigger closes the gap at the write path instead). **Needs to be applied via Supabase Studio before it takes effect.** |
| 1.6 | `setUserRoleAction` asserts the wrong permission | **Done** | Changed from `users.edit` to `roles.manage`, matching `user_role_assignments_write`'s actual RLS requirement. No behavior change for any working role today (Tenant Administrator holds both) — this only changes what a misconfigured custom role sees: a clean permission-denied message instead of a raw Postgres RLS error. |
| 1.7 | Tenant-by-slug re-resolved on every page | **Done** | New `lib/tenant/resolve-tenant-by-slug.ts` (`getTenantBySlug`, wrapped in React's `cache()`, mirroring `lib/supabase/current-user.ts`'s existing `getCurrentUser()` pattern). Replaced the independent `tenants.select(...).eq("slug", tenantSlug)` query in all 23 call sites under `app/(tenant)/t/[tenantSlug]/**` and `app/api/t/[tenantSlug]/**` — every route in one request tree now shares the same resolved row instead of paying a separate round trip each. |
| 1.8 | Stock page's sequential permission/entitlement checks | **Done** | `app/(tenant)/t/[tenantSlug]/(dashboard)/stock/page.tsx` — `can("inventory.view")` and `getInventoryEntitlement()` (switched from the throwing `assertInventoryEnabled` to the plain boolean-returning read, since both failure paths already redirected to the same place) now run in one `Promise.all` instead of two sequential awaits plus a try/catch. |
| 1.9 | `README.md` still the `create-next-app` default | **Done** | Real setup steps, script table, project-structure pointer, migration-application note, and a link into `docs/00-project-overview.md`. |

**Verification**: `npx tsc --noEmit` and `npm run lint` both pass clean across every file touched. Live verification (real dev server + a request to confirm the CSP/image/middleware behavior, plus applying 0039 and testing the cross-tenant rejection) is the next step before this phase ships to `main`.

## Phase 2 — App-level protections using existing data or Next.js/Supabase built-ins (still no new external tool)

| # | Item | Notes |
|---|---|---|
| 2.1 | Login lockout/backoff | `login_events` already records every failed attempt with the profile resolved — nothing reads it back yet. Count recent failures per email (and/or IP) and throttle past a threshold; no new table. |
| 2.2 | Product image upload — server-side validation | The `product-images` bucket has no `allowed_mime_types`/`file_size_limit` set at the Storage level (client-side JS is the only check today). Set both at the bucket, and add a server-side magic-byte check before accepting an upload. |
| 2.3 | `PlatformAdminService` unbounded queries | `getUsageAnalytics()`/`listTenants()` fetch entire `sales`/`payments`/`login_events` tables with no limit, and the storage-byte sum runs one tenant at a time, sequentially. Bound the reads, parallelize the storage sum. |
| 2.4 | Code-split `recharts` | Three chart components (`sales-trend-chart.tsx`, `product-performance-chart.tsx`, `stock-movement-chart.tsx`) load the charting library eagerly on routes where it renders above the fold. Wrap in `next/dynamic({ ssr: false })`. |
| 2.5 | Caching layer for read-heavy pages | No `revalidate`/`unstable_cache` usage anywhere. Analytics and Platform Analytics recompute from scratch on every navigation — a short-TTL `unstable_cache` keyed by tenant+range needs no new infrastructure. |
| 2.6 | Root error boundary | `app/error.tsx`/`app/global-error.tsx` don't exist. Adding them doesn't need Sentry to already be wired up — they can render a clean fallback and `console.error` today, then gain real reporting once Phase 4 lands it. |
| 2.7 | Basic CI | No `.github/workflows/*` exists. A lint+typecheck+build workflow on push uses GitHub, which the project already has — no new account. |

## Phase 3 — Content (no new tool, but real writing, not a config change)

| # | Item | Notes |
|---|---|---|
| 3.1 | `/privacy-policy`, `/terms-of-service`, `/support` | Currently exist only as an unchecked Play Store checklist item in `docs/AndroidAdvisory.md`. Needed for the live web app regardless of whether a native app ever ships — it's handling payment data and PII today. |

## Phase 4 — New external tools (need an account/signup, still no new server infrastructure beyond what Vercel already runs)

| # | Item | Notes |
|---|---|---|
| 4.1 | Error tracking (Sentry) | Referenced as already wired in by several docs (`docs/09-business-day-engine.md`, `docs/17-devops-deployment.md`) — it isn't. Needs a real Sentry account + `@sentry/nextjs`. Feeds Phase 2.6's error boundaries once live. |
| 4.2 | Transactional email (Resend) | Sign-up confirmation/password reset/invites all currently run on Supabase Auth's built-in email, which has already been observed hitting its rate limit during ordinary use (`docs/20-development-progress.md`). Needs a Resend account + domain verification. |
| 4.3 | Broader rate limiting (Upstash Ratelimit or similar) | Beyond Phase 2.1's login-specific fix — general abuse protection on signup/password-reset/webhook needs a real distributed rate limiter, which means a new external service. |

## Phase 5 — Test infrastructure (needs local tooling beyond what's installed)

| # | Item | Notes |
|---|---|---|
| 5.1 | Get the pgTAP tenant-isolation suite running | `tests/pgtap/001_tenant_isolation.sql` (20 assertions) has never been executed — needs a local Supabase stack (`supabase start`, Docker). |
| 5.2 | CI-wired smoke tests | A handful of Playwright tests covering the golden paths, added to Phase 2.7's CI workflow once it exists. |

## Phase 6 — Larger strategic projects (real scoping needed, deliberately last)

| # | Item | Notes |
|---|---|---|
| 6.1 | A second payment gateway (e.g. Stripe) | Paystack-only is a hard regional limit outside Africa. New account, new webhook endpoint, real work behind the existing `BillingService` abstraction. |
| 6.2 | i18n rollout | `next-intl` is installed and listed in the stack but wired up nowhere — every string is hardcoded English. A real content/translation project, not a config flip. |
| 6.3 | Account deletion / self-service data export | Beyond the existing sales-history CSV export — a real feature needing product decisions about tenant-owner vs. invited-member deletion semantics (mirrors the same distinction already made for tenant deactivation). |
| 6.4 | Backup/disaster-recovery plan | No documented backup/restore story exists (`docs/17-devops-deployment.md` covers everything else about deployment but not this). Needs a decision on retention and an actual tested restore drill, not just a paragraph. |

---

*Source: the three-part platform-health audit (security/performance/completeness) conducted 2026-08-27 — see the conversation this doc originated from for the full finding list with exact file:line evidence. This doc tracks remediation; it doesn't restate every finding's evidence.*

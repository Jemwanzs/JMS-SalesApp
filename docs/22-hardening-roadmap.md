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

| # | Item | Status | Notes |
|---|---|---|---|
| 2.1 | Login lockout/backoff | **Done, migration not yet applied** | `SecurityService.countRecentFailedLogins()` counts recent failures two independent ways — by `profileId` (5 in 15 min locks one account) and by `ip` (20 in 15 min, deliberately much higher, catches a sweep across many unknown emails from one source without punishing shared-network logins). `sign-in.ts` resolves the profile-by-email lookup once, up front, and checks the lockout **before** ever calling `authService.signIn()` — a locked-out attempt never even reaches Supabase Auth. A sliding window, not a permanent lock (see the migration's own header comment for why: a permanent lock keyed on failures is itself an easy way to lock out a real user on purpose). New index: `supabase/migrations/0040_login_events_ip_index.sql` (the by-IP count had no supporting index before this). **Needs 0040 applied via Supabase Studio.** Verified live: 6 seeded failures correctly counted and correctly cross the 5-per-profile threshold. |
| 2.2 | Product image upload — server-side validation | **Done, migration not yet applied** | `supabase/migrations/0041_product_images_bucket_limits.sql` sets real `file_size_limit`/`allowed_mime_types` on the `product-images` Storage bucket — enforced by Supabase Storage itself, server-side, regardless of what the client claims (the existing client-side JS check stays too, as the fast-feedback layer). SVG is deliberately excluded from the allowed types (script-in-SVG risk on a bucket that's public with no signed-URL indirection). A full server-side magic-byte re-check would need re-architecting the upload from direct-to-Storage into a server-proxied one — a bigger change than this phase's scope, left as a candidate for later, not silently dropped. **Needs 0041 applied via Supabase Studio.** Verified live against a real authenticated `products.edit` session (not just RLS): a 6MB upload was rejected ("exceeded the maximum allowed size"), an SVG upload was rejected ("mime type image/svg+xml is not supported"). |
| 2.3 | `PlatformAdminService` unbounded queries | **Done** | `listTenants()`'s `payments`/`login_events` reads now carry a `RECENT_ROWS_LIMIT` (10,000) — a safety cap against literal unbounded growth, not a perfect fix (a true fix is a SQL-level "last row per tenant_id" aggregate, which this isn't yet; documented honestly in the code comment rather than overclaiming). `computeStorageBytesByTenant` was fully sequential by original, deliberate design (documented trade-off to stay gentle on Storage's API) — changed to bounded concurrency (5 tenants at a time) rather than either extreme, keeping that original intent while no longer being O(tenant count) sequential round trips. |
| 2.4 | Code-split `recharts` | **Done** | `next/dynamic({ ssr: false })` can't be called directly inside a Server Component page (Next.js requirement), so each chart got a small `"use client"` wrapper (`*-chart-lazy.tsx`) that does the dynamic import with a `Skeleton` loading state sized to match `ChartContainer`'s own fixed height — no layout shift once the real chart mounts. `analytics/page.tsx` and `stock/reports/page.tsx` now import the lazy versions. |
| 2.5 | Caching layer for read-heavy pages | **Done for the safe target; tenant-scoped Analytics deliberately deferred** | `PlatformAdminService.getUsageAnalytics()` is now wrapped in `unstable_cache` (60s TTL, no per-caller key needed) — safe specifically because every platform admin sees the identical output regardless of who's asking. The tenant-facing Analytics page is **not** cached: its results vary per caller's own `analytics.view_all`/`view_own` grant, and a cache entry not keyed on that would risk serving one user's permission-scoped data to another — a real correctness/security risk, not a quick win as originally scoped. Needs a proper permission-aware cache key design before it's safe; left for a future increment rather than shipped unsafely. |
| 2.6 | Root error boundary | **Done** | `app/error.tsx` (catches everything below the root layout) and `app/global-error.tsx` (the only boundary that can catch the root layout's own errors — Next.js requires it to render its own complete `<html>`/`<body>`, deliberately kept dependency-minimal since something reaching this boundary means a lot else may also be broken). Both `console.error` today; Phase 4.1 (Sentry) only needs to add a call inside the same effect, not restructure anything. |
| 2.7 | Basic CI | **Done** | `.github/workflows/ci.yml` — lint, typecheck (new `npm run typecheck` script), and build on every push/PR to `main`/`development`. Build uses non-secret placeholder `NEXT_PUBLIC_*` values (CI never actually calls Supabase, just needs `next build` to complete) rather than real secrets. Verified locally: the exact same `npm run build` with the same placeholder env vars used in the workflow completes cleanly, producing all 24 routes. |

**Shipped alongside Phase 2** (not part of the audit, added by explicit request):
- **Login background less blurry** — `blur-md` → `blur-sm`, wash overlay opacity reduced, so the photo stays recognizable rather than reading as an abstract wash.
- **"Others" product always last** — verified live, not a bug: `ProductService.listAll()`/`listActive()` already order `is_system` last (a prior increment, not new work this phase). Confirmed against real data: `["Zebra Product", "Apple Product", "Others"]` — Others stays last regardless of the other products' own order.
- **User manual mentions the Inventory add-on** — `docs/USER_GUIDE.md` and the PDF generator (`scripts/build-user-guide-pdf.mjs`) both gained a new "Inventory & Stock Management (optional add-on)" subsection under Billing: optional, independent subscription from the base plan, affordable tiered pricing, free trial. `public/docs/User-Guide.pdf` regenerated from the updated source.

**Verification**: `npx tsc --noEmit`, `npm run lint`, and a full `npm run build` all pass clean. Live-verified: login lockout counting, Others-last ordering, and the new bucket limits, all against real seeded data — see each row above.

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
| 6.4 | Backup/disaster-recovery plan (Google Drive advisory below) | No documented backup/restore story exists (`docs/17-devops-deployment.md` covers everything else about deployment but not this). Needs a decision on retention and an actual tested restore drill, not just a paragraph. |

---

### 6.4 advisory — using Google Drive for backups

*Advisory only, nothing implemented — same status as `docs/AndroidAdvisory.md`/`docs/OfflineFirstSyncAdvisory.md`. Written 2026-08-27.*

**Is it possible? Yes, cleanly, with one important caveat.** Google Drive should be a **second, portable, off-platform copy** — not a replacement for Supabase's own native backup/PITR (Point-in-Time Recovery, a paid-tier feature). Supabase's own backups are the right tool for "restore to 10 minutes ago after a bad migration"; a Drive copy is the right tool for "Supabase itself became unreachable, the project got deleted, or the account was locked" — a genuinely different failure mode that an in-platform backup can never cover, no matter how good it is.

**Where it would run.** This app is fully serverless (Vercel functions + Supabase) — there's no always-on server to run `pg_dump` from, and Vercel's function runtime doesn't have `pg_dump` available or the execution-time headroom for a growing database dump. The clean fit is a **scheduled GitHub Actions workflow** (a real Ubuntu runner, `pg_dump` installable via `apt`, connects directly to Supabase's Postgres connection string, and runs on GitHub's cron — separate infrastructure from both Vercel and Supabase, which is exactly the point of a second copy). This reuses the CI infrastructure Phase 2.7 just added rather than inventing a new execution environment.

**Configurable cadence — reusing an existing pattern in this codebase.** GitHub Actions `schedule:` cron entries are static in the workflow file, so "super-admin configurable, daily or hourly" needs the same trick this app already uses for `run_business_day_sweep()` (runs every 5 minutes but only *acts* when a business's own configured hours say so): the workflow runs on a fixed, frequent tick (e.g. hourly), reads a `platform_settings` row (`backup_frequency_hours`, matching the exact shape `trial_days`/`grace_period_days` already use) and a `last_backup_completed_at` timestamp, and no-ops unless enough time has actually elapsed. A Super Admin changes the cadence by editing that one setting — no workflow-file redeploy needed, consistent with how every other global policy value in this app already works.

**Recommended default: daily, not hourly.** A full `pg_dump` is a discrete point-in-time snapshot — running it hourly multiplies storage/bandwidth cost for very little real protection benefit once daily is already in place, since true minute-by-minute protection is what Supabase's own PITR is *for*, not what a Drive copy should try to replicate. Daily matches the cadence Supabase's own Pro-tier automatic backups already use. Make it configurable (per the pattern above) for whoever wants tighter or looser cadence, but default to daily.

**What should be backed up.**
- **Tier 1 — everything that can't be regenerated, always included**: `tenants`, `profiles`, `tenant_memberships`, `roles`/`role_permissions`/`user_role_assignments`, `products`, `sales`, `sale_corrections`, `subscriptions`/`payments`/`tenant_addon_subscriptions`/`addon_payments`, `audit_logs`/`platform_audit_logs`. The financial ledger and every compliance trail belong here without question.
- **Tier 2 — worth including, same "can't be regenerated" reasoning**: `stock_movements`/`stock_reconciliations` (the inventory ledger, for tenants with the add-on on).
- **Deliberately excluded**: anything derivable/cached (`insights_snapshots` — recomputable from `sales`), and `login_events`/`sessions` (operational, not financial — lower value, and needlessly widens what a leaked backup file would expose).
- **Product images (Storage)**: lower priority, not Day 1. They're regenerable (a tenant can just re-upload), and including them would make the backup payload much larger/slower for comparatively low value — a reasonable fast-follow, not part of the initial scope.

**Format.** `pg_dump -Fc` (Postgres's custom compressed format, restorable directly via `pg_restore`, and the only format here that captures schema/functions/RLS policies alongside data — a plain CSV/JSON export can't reconstruct `has_permission()` or the RLS policy set at all). This is the disaster-recovery-grade artifact. A lighter per-tenant CSV/JSON export for a tenant's own self-service "download my data" is a genuinely different, separate need — that's Phase 6.3's territory (and partially already exists via the sales-history CSV export today), not something this backup job should also try to be.

**The one requirement that isn't optional: encrypt the file before it leaves Supabase.** A `pg_dump` of the whole database is, by definition, every tenant's data in one file with no RLS around it anymore — the moment it lands in Drive, tenant isolation is only as strong as who has access to that Drive folder. Two things, both required, not either/or: (1) share the destination Drive folder with **only** the backup service account and the platform owner's own account — nothing broader; (2) encrypt the dump (e.g. `gpg --symmetric` with a passphrase held outside both GitHub and Google, or age/openssl) before upload, so a Drive-level access mistake alone doesn't equal a full data breach. Treat this the same way the rest of this hardening pass treats "don't create a second place PII can leak from."

**Mechanics, concretely.** Google Cloud Console → new project → enable the Drive API → create a Service Account → generate its JSON key → share one dedicated Drive folder with that service account's email (Editor on that folder only, nothing else in anyone's personal Drive) → store the JSON key and the target folder ID as GitHub Actions Secrets (not Vercel — the job runs in GitHub Actions, per the architecture above) → the workflow authenticates as the service account and uploads via the Drive API v3.

**Retention.** Without a rotation policy, this silently fills Drive's quota over time (a free/personal Google account caps at 15GB shared across the whole account; Workspace plans vary) and the backup job would start failing quietly. A simple policy — e.g. keep daily backups for 30 days, one per week for a year, delete anything older — needs to be part of the same workflow, not an afterthought added later.

**Restore drills.** A backup nobody has ever restored from isn't a verified backup, it's an assumption. Once this exists, an actual periodic restore-into-a-scratch-project drill (not just "the upload succeeded") is what turns this from a checkbox into something trustworthy in a real emergency.

---

*Source: the three-part platform-health audit (security/performance/completeness) conducted 2026-08-27 — see the conversation this doc originated from for the full finding list with exact file:line evidence. This doc tracks remediation; it doesn't restate every finding's evidence.*

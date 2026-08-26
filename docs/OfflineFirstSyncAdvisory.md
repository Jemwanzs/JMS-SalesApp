# Offline-First Sales Capture & Sync — Advisory

*Status: **advisory only**. Nothing in this document has been implemented — no code, no migrations, no schema changes. This is the plan to follow **when** we decide to build offline capture, not a build log. Written 2026-08-26 — re-check the browser-support notes in §9 before starting, since Background Sync / storage-eviction behavior shifts across browser releases.*

---

## 1. Bottom line

This is a **real, multi-week feature**, not a small enhancement — it touches authentication, the sales-capture path, billing-adjacent data, and adds an entirely new local-storage/sync subsystem. It is buildable without disturbing the existing architecture, and this codebase already has two of the hardest pieces further along than a typical greenfield build would:

- **Idempotent writes already exist.** `sales.idempotency_key` (unique per tenant, `SalesService.recordSale`) already turns a duplicate submission into a safe replay instead of a second row. Offline sync's hardest requirement — never double-record a financial transaction — already has its foundation built and proven in production.
- **A PWA shell already exists.** `app/manifest.ts` (installable, standalone display, icons) and a registered `public/sw.js` are already live — today's service worker is a deliberate no-op ("Offline Sales Capture is an explicitly deferred future enhancement," per its own header comment), not a placeholder that needs inventing from scratch.

What's genuinely new: a local database (IndexedDB), a sync engine, offline-aware auth rules, and a real caching strategy in place of that no-op worker. Scope this internally as **"Offline Sales Capture & Sync"**, not "make the app a PWA" (that part is already done) and not "add a service worker" (one is already registered).

---

## 2. What stays exactly as it is

Every existing service, RLS policy, and the `has_permission()` model keep working unchanged. Offline capture is a **new client-side layer in front of** the existing write path, not a replacement for it:

```
                    ┌──────────────────────────┐
                    │         Browser            │
                    │  ┌─────────────────────┐  │
                    │  │   Next.js App Shell   │  │  ← cached by an upgraded sw.js
                    │  │  (existing UI, routes) │  │
                    │  └──────────┬───────────┘  │
                    │             │               │
                    │  ┌──────────▼───────────┐  │
                    │  │   IndexedDB (NEW)      │  │  ← products, drafts, outbox
                    │  │  via Dexie              │  │
                    │  └──────────┬───────────┘  │
                    └─────────────┼───────────────┘
                                  │  sync when online
                                  ▼
                    ┌──────────────────────────┐
                    │   Vercel (unchanged)       │
                    │  Edge Middleware            │  ← session refresh, see §6
                    │  Server Actions / Routes    │
                    └─────────────┬─────────────┘
                                  ▼
                    ┌──────────────────────────┐
                    │   Supabase (unchanged)     │
                    │  Postgres + RLS             │
                    │  has_permission()           │
                    │  Auth                       │
                    └──────────────────────────┘
```

Concretely: `services/*.ts`, every RLS policy from `supabase/migrations/0001_core_tenancy_and_rbac.sql` onward, Paystack billing, and the entire existing UI/UX are untouched. The sync engine calls the **same kind of server action / RPC boundary** everything else in this app already uses — it does not get a special bypass.

---

## 3. Phased implementation (maps the original 22-point spec onto buildable stages)

Each stage should ship, get tested, and be reviewable independently — do not attempt this as one giant PR.

**Stage 1 — Real PWA caching.** Upgrade `public/sw.js` from its current no-op to an actual cache-first-for-shell / network-first-for-data strategy (app shell, styles, icons). Add cache versioning so a new deploy invalidates the old cache cleanly (spec §1, §21) — this is the one piece of "convert to a real PWA" not already done.

**Stage 2 — Local data layer.** Add IndexedDB via **Dexie** (a thin, well-maintained wrapper — avoid hand-rolling raw IndexedDB transactions). Tables: cached products/reference data, draft sales, completed-offline sales, a sync outbox, and sync-attempt/conflict metadata (spec §4). Written once, on the first successful **online** login — never populated any other way, and scoped strictly to the signed-in tenant (spec §2, §9).

**Stage 3 — Offline-aware auth.** A configurable "offline access window" (a new `platform_settings` row, following the exact pattern `trial_days`/`grace_period_days` already use) bounding how long a previously-authenticated session may keep capturing sales without reaching Supabase again. No passwords cached, no parallel login path — this reuses the Supabase session already held by the browser client, just tolerates it being unrefreshable for a bounded window (spec §3).

**Stage 4 — Offline sales capture UI.** Product search against the cached copy, save-draft, submit-offline, a connectivity/sync-status indicator, and a visible pending-sync queue (spec §5, §6, §19). Every offline-created sale gets a locally generated UUID immediately and is visually marked "Saved on Device" — never "Synced" — until the server confirms it.

**Stage 5 — Sync engine.** Runs on reconnect, on app foreground, and on a manual "Sync Now" (spec §7). Reuses the existing `idempotency_key` mechanism as the dedup key end-to-end — the local UUID generated in Stage 4 **is** the idempotency key sent to `SalesService.recordSale`, so the duplicate-prevention story here is "route the already-built mechanism through a queue," not "invent one" (spec §8).

**Stage 6 — Server-side revalidation.** A migration adding whatever's still missing for a safe sync entrypoint (most of the constraint work is already done — see §4 below), and a sync action/RPC that revalidates permissions, product status, and tenant scope **server-side** before ever trusting a queued record (spec §9, §10) — the same posture `record_stock_reconciliation()` and `void_sale()`/`correct_sale()` already use for exactly this kind of "don't trust the client" write.

**Stage 7 — Conflict handling & "Action Required."** A synced sale is never silently overwritten by a stale offline copy; a permission revoked while offline blocks auto-insert and flags the record instead of discarding it (spec §10, §11).

**Stage 8 — Payments/receipts caveats.** Offline capture records the *reported* payment method/amount only; Paystack/M-Pesa confirmation and official receipt generation both stay strictly online-only, matching how billing already works today (spec §13).

**Stage 9 — Storage hygiene, testing, rollout.** Storage-quota warnings, retention/archival of synced local records, a feature flag (new — see §7 below) for controlled rollout, and the full test matrix in the original spec §20.

---

## 4. What this codebase already has that shortens the work

Worth stating plainly, since it changes the effort estimate:

| Spec requirement | Already exists |
|---|---|
| Idempotency key on sales, unique per tenant | `sales.idempotency_key` + `SalesService.recordSale`'s conflict-then-replay logic — done. |
| Server-generated sale numbering, not client-sequential | `sale_number` is already generated server-side from a per-tenant template (`docs/08-sales-engine.md`), never client-computed — matches spec §12 already. |
| Installable PWA shell | `app/manifest.ts` + registered `public/sw.js` (`components/shared/service-worker-registration.tsx`) — done; the worker itself just needs a real strategy (Stage 1). |
| "Don't trust a client-supplied tenant ID" pattern | Every existing service already derives `tenant_id` server-side from the authenticated session, never a request body field — the sync entrypoint just needs to follow the same rule. |
| A precedent for safe, permission-checked, client-untrusted writes | `record_stock_reconciliation()` and `void_sale()`/`correct_sale()` (`docs/19-security-checklist.md`) already establish the exact `SECURITY DEFINER` + in-function `has_permission()` check pattern a sync RPC would reuse. |
| Configurable, `platform_settings`-backed policy values | `trial_days`, `grace_period_days`, and (as of this session) the Inventory add-on's own trial-days keys all follow one established pattern — the offline-access window (Stage 3) is one more row of the same shape, not a new mechanism. |

---

## 5. Infrastructure implications

### Vercel Edge Middleware vs. offline navigation
`middleware.ts` runs `updateSession()` (Supabase session refresh) on almost every request today, matched broadly (`config.matcher` excludes only static assets). Middleware **cannot run at all** when the device is offline — there is no request reaching Vercel. This is not a blocker (the whole point of the service worker is to intercept the request *before* it would hit the network), but it means the service worker's fetch handler must explicitly serve the cached app shell for navigation requests while offline, rather than assuming middleware will ever get a chance to run. Get this interaction wrong and the failure mode is a blank/broken screen instead of a graceful offline page — worth its own explicit test in Stage 1.

### Supabase load shape changes
Today, writes are one request per sale, spread out as they happen. A sync engine reconnecting after a field agent has been offline for hours introduces **bursty batch writes** — N queued sales landing in a short window. Batch the sync engine's own requests (spec §7 already calls for this) and expect to revisit `sales`/`stock_movements` insert-path indexes if batch sizes grow large in practice; nothing to change now, just a load pattern this repo hasn't had to handle before.

### Service worker cache versioning on every deploy
Vercel deploys are frequent in this project's history (dozens of shipped phases this session alone). Each deploy needs the service worker's cache version bumped so stale JS/CSS never gets served from an old cache after a redeploy — and, per spec §21, a new deploy must never wipe **pending, unsynchronized** IndexedDB records. These are two different stores with two different invalidation rules (cache = safe to nuke on version bump; IndexedDB outbox = never auto-cleared) — conflating them is the most likely way this goes wrong.

### Browser/OS storage is not guaranteed durable
IndexedDB storage can be evicted by the browser under storage pressure, especially on iOS Safari (no installed-PWA exemption there the way Android/Chrome gets one) and in any private/incognito context. `navigator.storage.persist()` should be requested (spec §15), but its grant is a browser heuristic, not a guarantee — this is a real risk to a **financial record**, not just UX polish, and should be called out to users explicitly (the spec's own required warning text in §15 already covers this correctly).

### Background Sync API support is inconsistent
Chrome/Android support the Background Sync API; Safari/iOS does not (spec §7 already flags this and correctly requires an application-level fallback — sync-on-foreground/sync-on-open — rather than depending on it). Treat Background Sync as a nice-to-have acceleration, never the only sync trigger.

### No feature-flag mechanism exists yet
This codebase has no third-party flag service and, consistent with its own minimal-dependency posture, shouldn't need one — a `platform_settings` boolean (or a per-tenant `tenant_settings` key, mirroring the Inventory module's own `inventory_enabled` toggle pattern) is enough for a controlled rollout, gating the new service-worker strategy and offline-capture UI behind it.

### Security surface increases with anything cached client-side
Every byte written to IndexedDB is a byte that persists on a possibly-shared or possibly-lost device. Cache products/reference data and the session's own profile — never another tenant's data (already a hard existing RLS guarantee, but the *cache* itself needs the same discipline explicitly, since a bug here wouldn't be caught by RLS at all, only by the client code being correct) — and cache the minimum needed for sales capture, not the tenant's full dataset.

### Cost
Modest. No new paid infrastructure is implied — IndexedDB is browser-native, Dexie is a small client dependency, and the sync engine rides on the same Vercel/Supabase usage this app already pays for. The main cost driver is engineering time (a genuinely multi-stage build) and QA time (the spec's own §20 test matrix is large and mostly manual/device-dependent, e.g. Android Chrome installed-PWA behavior).

---

## 6. Risks & recommendations

- **Biggest risk is financial-record integrity, not UX.** A duplicated or silently-dropped sale is worse than any offline-UX rough edge. Lean on the existing idempotency-key mechanism end-to-end rather than any new dedup scheme, and never let a sync failure delete a local record (spec §5, §7, §15 are all explicit about this already — hold the line on it during implementation).
- **Do not let this become "rewrite the sales flow."** `SalesService.recordSale` and `recordSaleSchema` already do the validation and idempotent-insert work; the sync engine's job is to call that same path with a queued record, not to reimplement sale recording client-side.
- **Build Stage 1 (real caching) and Stage 2 (IndexedDB) before anything user-facing.** Everything downstream depends on both existing and being reliable; rushing to a demo-able "offline sale" screen before the storage/caching foundation is solid is the most common way this class of feature ships buggy.
- **Treat iOS Safari as the worst case, not an edge case.** Its storage-eviction behavior and lack of Background Sync support should shape the design (aggressive foreground/manual sync, clear low-storage warnings), not be patched in afterward.
- **Roll out behind a flag, one tenant at a time if possible**, given this touches auth and financial writes — the existing Inventory add-on's tenant-by-tenant activation (Super Admin's Tenant 360 panel) is a workable precedent for how to stage this safely.

---

## 7. Pre-flight checklist (when this actually starts)

- [ ] Confirm Dexie (or an equivalent maintained IndexedDB wrapper) as the local-database dependency — don't hand-roll raw IndexedDB.
- [ ] Decide the default offline-access window (Stage 3) and where it's configured (global `platform_settings` vs. per-tenant).
- [ ] Design the sync RPC's exact shape (batch size, response format, error taxonomy) before writing the migration for it.
- [ ] Confirm which existing indexes on `sales`/`stock_movements` need review for batch-write load (§5) — likely none yet, but check before, not after, a real burst.
- [ ] Decide the feature-flag mechanism (a new `platform_settings`/`tenant_settings` key, per §5) before writing any UI behind it.
- [ ] Write the service-worker cache-versioning scheme and confirm it never touches the separate IndexedDB outbox (§5) — test this explicitly across a real redeploy with pending records still queued.
- [ ] Plan the manual + automated test matrix (spec §20) against real devices — Android Chrome and an installed PWA specifically, not just desktop DevTools offline mode.
- [ ] Get a real product decision on offline handling for electronic-payment verification and official receipts (§8/spec §13) before building the payment-method UI, not after.

---

*Cross-references in this repo: `app/manifest.ts`, `public/sw.js`, `components/shared/service-worker-registration.tsx`, `middleware.ts`, `lib/supabase/middleware.ts`, `services/SalesService.ts`, `validations/sale.ts`, `docs/02-system-architecture.md`, `docs/05-authentication-security.md`, `docs/08-sales-engine.md`, `docs/14-billing-paystack.md`, `docs/19-security-checklist.md`, `docs/AndroidAdvisory.md` (a comparable advisory-only precedent in this repo).*

# 18 — Testing & QA

## The most important test in the whole system

> **Tenant A must never read, modify, export, or infer Tenant B's information.**

Proven with pgTAP tests running directly against RLS policies (not only through the app layer) using two permanently-seeded test tenants, `Tenant Alpha` and `Tenant Beta` (spec §134). This suite runs before any feature that builds on Phase 1b's schema is considered safe to build further, and again before every major release.

## Test layers

### Unit tests (`tests/unit/`)
Amount calculations, permission checks (`can()` / `has_permission` logic against fixtures), sale-numbering assignment, day-close rules, analytics calculations.

### pgTAP tests (`tests/pgtap/`)
Direct-to-Postgres tests of RLS policies and `SECURITY DEFINER` functions:
- Tenant A cannot `SELECT`/`UPDATE`/`DELETE` Tenant B's rows on any tenant-scoped table.
- A user with no `tenant_memberships` row for a tenant gets zero rows, not an error.
- `has_permission()` correctly denies write-type permissions when `tenants.status = 'suspended'`.
- Audit tables reject `UPDATE`/`DELETE` outright (no policy exists for those commands).
- Platform-admin tables are unreachable via the `authenticated` role entirely.

### Integration tests (`tests/e2e/` — Playwright)
```
Login -> Record Sale
Record Sale -> Analytics reflects it
Close Day -> Sale creation blocked
Subscription webhook -> Tenant activated
Role assignment change -> Permission takes effect
```

### Security tests
```
Normal user cannot become admin (no client-writable path to role_permissions/user_role_assignments)
Closed sale cannot be changed outside an approved correction flow
Unauthorized export is rejected (download passcode / permission check)
Expired temporary access fails closed, not open
Webhook with an invalid Paystack signature is rejected
```

### Responsive / mobile testing
Every screen validated at the ~430–480px mobile-shell width (the actual target, not just "does it not break on desktop") — see `07-ui-ux-screen-map.md`.

## What "done" means for a phase

A phase is not marked complete in `20-development-progress.md` until:
1. Its migrations have RLS/pgTAP coverage where relevant.
2. Its critical user flow has at least one integration test.
3. `npm run build` and `npm run lint` pass with the feature included.
4. Manual verification of the golden path (`Login -> Capture Sales`, or the phase's equivalent) actually occurred — type-checking and unit tests verify correctness, not the real feature working in a browser.

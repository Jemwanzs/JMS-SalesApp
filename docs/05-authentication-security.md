# 05 — Authentication & Security

## Authentication (Supabase Auth)

- Email/password via Supabase Auth, `@supabase/ssr` for cookie-based session handling across server components/actions/route handlers.
- Email verification required before a tenant is usable (spec §9.1).
- Password reset via Supabase's secure reset-link flow. Passwords are never visible to anyone, including Tenant Administrators and Platform Super Admins — see "Password visibility boundary" below.
- Optional MFA (TOTP via Supabase Auth) — required (not optional) for: business-day reopen, Platform Super Admin impersonation, and any action gated by `security.manage`-level sensitivity.
- A `profiles` row is auto-created via a Postgres trigger on `auth.users` insert (never created manually in application code, so it can't drift out of sync).

## Password visibility boundary

Neither Tenant Administrators nor Platform Super Admins can ever see:

```
Password / Password Hash / Authentication Secret / MFA Secret
```

Available actions instead: send password reset, disable user, revoke sessions, impersonate an *approved* user (platform admin only, see `15-super-admin.md`).

**Hard implementation rule**: `PlatformAdminService` (and any tenant-side `UserService` admin methods) never read from `auth.*` schema tables directly. Any operation that needs Supabase-Auth-admin capability (force reset, disable) goes exclusively through `supabase.auth.admin.*` SDK calls under the service-role key — never a direct table read of `auth.users`/`auth.mfa_factors`. This is easy to violate accidentally (a future "just get one more field" query) and is called out explicitly so it doesn't happen.

## Sessions & login tracking

- `login_events`: user, timestamp, IP, approximate location, device type, browser, OS, session ID, success/failure, logout time. Device/browser identification is best-effort, not a guaranteed physical-device fingerprint (spec §72).
- `sessions`: active session list per user, with revoke capability (self-service and admin-driven).

### Smart Auto-Login & 12-Hour Session

Two distinct pieces, not one mechanism:

1. **Auto-login.** `app/(auth)/login/page.tsx` checks `getCurrentUser()` first and redirects an already-signed-in visitor straight into the app (reusing `app/page.tsx`'s existing tenant/onboarding routing) instead of showing the form again. This was the actual root cause of "users keep being asked to log in" — the underlying `@supabase/ssr` cookie/refresh mechanics were already correct (default cookie `maxAge` is 400 days, and `lib/supabase/middleware.ts` refreshes the access token via `getUser()` on every request); the login screen itself simply never checked for an existing valid session before rendering.

2. **A hard, non-extending 12-hour cap**, enforced in `lib/supabase/middleware.ts` (the one place that already runs on every request and can write cookies). Anchored to `sessions.created_at` — written once, at actual sign-in (`SecurityService.createSession()`), never touched by a token refresh — not the JWT's own `iat`/`exp`, which would let the window slide forward forever with continued use. On every authenticated request, `now (server clock) − sessions.created_at (server-written) > 12h` forces a real sign-out (`supabase.auth.signOut()`), clears the `sid` cookie, marks that `sessions` row `revoked_at`/`revoked_reason`, writes an `AUDIT_ACTION.SESSION_REVOKED` entry, and redirects to `/login?sessionExpired=1` (a small banner explains why). A session with no `sid` cookie or no matching row (predates this feature, or the best-effort cookie write failed) is left alone rather than forced out — no basis to enforce a limit that can't be measured, same self-heal posture as `active_branch_sessions`.

Manual logout (`features/auth/actions/sign-out.ts`) also now clears the `sid` cookie and marks the `sessions` row revoked (`"Signed out"`), closing a pre-existing tracking gap — the real Supabase session cookies were already being cleared correctly, so a manually-logged-out user was never actually at risk of silent auto-relogin.

## Working-hours access restriction

Tenant-configurable: `restrict_login_to_working_hours`. When enabled, a session nearing the configured end time gets a countdown warning, then: stop new transactions → save safe draft state where applicable → sign out → log the event (spec §74–75).

## Geo-fencing

Tenant-configurable per location: allowed lat/long + radius. Login flow checks the user's location (with explicit browser permission/consent) against the fence.

**Resolved ambiguity** (scope said "handle gracefully" without specifying what that means): when geolocation is denied or unavailable, the user is **automatically routed into the temporary-access-request flow** (see below) rather than silently allowed in or hard-blocked with a dead end. This reuses infrastructure already built for the explicit "outside authorized location" case and gives every tenant an auditable path forward instead of an unrecoverable state.

## Temporary access requests

Blocked user → "Request Temporary Access" (reason, current location, requested duration) → creates an `approval_requests` row (type `temporary_location_access`) → admin approves/rejects with a bounded duration → `temporary_access_requests` row tracks the grant window → countdown UI with a final warning → auto-revoke at expiry via the same scheduled sweep used for business-day reopen (see `09-business-day-engine.md`). This is the Approval Engine's second consumer — see `19-security-checklist.md` §5 for the generic design.

## Composed access restrictions

Working-hours restriction, geo-fencing, tenant suspension, and edit-window rules can all independently want to block the same action. Rather than each subsystem failing independently (confusing stacked/contradictory errors), a single **access-gate composition point** in `AuthService`/`SecurityService` evaluates all applicable restrictions together for a given action and returns one prioritized, user-legible reason.

## Download security

Tenant-configurable `require_download_passcode`, applied to sales/transaction/analytics/audit exports in CSV/Excel/PDF. Passcode is stored hashed (`hashed_download_passcode`), never plaintext. Flow: Download Report → Enter Passcode → Validate → Permission Check → Generate File → `download_audit` event.

## Audit logging

`audit_logs` covers (non-exhaustive): `LOGIN`, `LOGOUT`, `FAILED_LOGIN`, `SALE_CREATED/EDITED/VOIDED`, `BUSINESS_DAY_OPENED/CLOSED/REOPENED`, `PRODUCT_CREATED/EDITED`, `USER_INVITED/DISABLED`, `ROLE_CHANGED`, `PERMISSION_CHANGED`, `EXPORT_REQUESTED/COMPLETED`, `SECURITY_SETTING_CHANGED`, `TEMPORARY_ACCESS_REQUESTED/APPROVED/REJECTED`, `SUBSCRIPTION_CHANGED`, `IMPERSONATION_STARTED/ENDED`.

Structure: `id, tenant_id, actor_profile_id, action, entity_type, entity_id, old_values, new_values, reason, ip_address, device, timestamp, metadata`. Sensitive values are redacted before write (never store secrets/tokens in `metadata`/`old_values`/`new_values`). No UPDATE/DELETE RLS policy exists on this table — see `03-database-schema.md`.

## Security baseline checklist

See `19-security-checklist.md` for the literal, trackable checklist version of everything in this document.

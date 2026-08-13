# 15 — Platform Super Admin

## Separation from tenant app

The Platform Administration Console (`app/(platform-admin)/admin/`) is a completely separate app shell/navigation from ordinary tenant screens — different layout, different guard (`is_platform_admin()`), never reachable via tenant navigation.

## Not a hardcoded email

`platform_admins` (`profile_id` unique, `role`: super_admin/support/billing_ops) is a real table, not a single-email check scattered through application logic. `jamosammy@gmail.com` (spec §92) is used **only once** — as the bootstrap seed value when the first admin row is created — so the system supports multiple platform administrators from the start, as the spec itself recommends.

## Platform-admin tables are not on the normal RLS surface

`platform_admins`, `platform_audit_logs`, `impersonation_sessions` have **no policy granting the `authenticated` role access at all**. They're reachable only via the service-role client after an explicit `is_platform_admin(auth.uid())` app-layer check inside `PlatformAdminService`. A compromised tenant-side session can never enumerate or query them, regardless of any RLS policy bug elsewhere — this is a stronger guarantee than "RLS denies it," it's "RLS was never asked."

## What Super Admin can and cannot see

**Can see**: user name, email, role, status, last login, sessions.
**Cannot see, ever**: password, password hash, authentication secret, MFA secret (spec §98). Enforced structurally, not just by convention — see `05-authentication-security.md`'s hard rule that `PlatformAdminService` never reads `auth.*` tables directly, only `supabase.auth.admin.*` SDK calls under service-role for reset/disable actions.

**Available actions**: send password reset, disable user, revoke sessions, impersonate an *approved* user.

## Impersonation ("Access Workspace")

```
Access {Tenant}? -> Reason required -> Platform MFA -> Time-limited session -> Immutable audit
```

Requires: reason, platform MFA, a bounded session duration, and a visible "SUPPORT MODE — viewing {Tenant} as Platform Administrator — Ends in {countdown}" banner for the entire duration (spec §96).

**This is always logged — no exceptions.** The spec explicitly overrides an earlier draft suggestion that impersonation logging might be skippable: `impersonation_sessions` + `platform_audit_logs` capture platform admin, tenant, reason, start, end, actions taken, IP, device — retained in the platform-security audit store that tenant users cannot alter (whether *tenants* can see that an impersonation occurred is a separate policy decision; the platform's own record of it is never optional).

## Tenant management

List view: business, owner, users, plan, status, trial, last payment, next payment, last activity. Actions: view, suspend, reactivate, extend trial, adjust grace period, send reminder, access workspace, view billing, view usage — every action routes through `PlatformAdminService`, which writes the corresponding `platform_audit_logs` row as part of the same operation, not as an afterthought.

## Business anniversaries

`tenants.anniversary_date` tracked; Super Admin dashboard surfaces upcoming anniversaries. Automated wish messages are tenant-configurable: Automatic / Review Before Sending / Disabled (spec §100) — never forced on a tenant that hasn't opted in.

## Platform usage analytics

Sales records by tenant, DAU/MAU, sales captured per tenant, storage consumption, product count, import volumes, report usage, login frequency, subscription/trial conversion, churn (spec §101) — read-only aggregation, computed from the same tenant data via service-role, never exposed back to any tenant-scoped RLS-reachable view.

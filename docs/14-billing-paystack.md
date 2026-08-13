# 14 — Billing (Paystack)

## Subscription states

```
TRIAL -> ACTIVE -> PAYMENT_DUE -> GRACE_PERIOD -> SUSPENDED
                 \-> CANCELLED
```

`subscriptions`: `tenant_id` (unique), `plan_id`, `status`, `trial_end`, `current_period_start/end`, `next_billing_date`, `grace_period_end`, `paystack_customer_code`, `paystack_subscription_code`.

## Free trial — decision log

Spec §11 specifies a **1-day** free trial. **Resolved during planning** (confirmed with the client): the default is **7 days**, configurable per-tenant and globally by Platform Super Admin — not hardcoded. Rationale: 24 hours is unusually short for a B2B tool where an admin needs to add products, invite staff, and possibly run a historical-sales import before meaningfully evaluating the product; almost every tenant would hit `TRIAL -> PAYMENT_DUE` before real use, making the elaborate grace/suspension state machine load-bearing on day one rather than an edge case. The state machine itself is unchanged — only the default duration.

## Grace period

Configurable globally by Platform Super Admin: 0/1/3/7 days/custom (spec §90). Applied uniformly via `subscriptions.grace_period_end`, checked the same way trial expiry is checked.

## Webhook is the sole source of truth

Payment status is **never** derived from a frontend "success" screen. Flow:

```
User Pays -> Paystack -> Webhook (app/api/webhooks/paystack)
  -> verify signature -> BillingService -> update subscriptions -> audit -> notification
```

`billing_events` records every processed `paystack_event_id` (unique) as an idempotency ledger — a redelivered webhook is a no-op, not a double-processed payment. The route handler runs under the **service-role** Supabase client; no client-authenticated path ever writes `subscriptions`/`payments` directly (see `03-database-schema.md` §3.8).

Actual recurring payment methods available on the merchant account should be validated against Paystack's current subscription documentation during integration, since documented method support varies — flagged here so it isn't assumed at implementation time.

## Suspension behaviour

On `SUSPENDED`:

- **Disabled** (enforced via `has_permission` folding in `tenants.status`, see `04-multi-tenancy.md`): new sales, edits, exports, user administration.
- **Preserved**: billing-owner login, billing screen, historical data (read-only), payment ability.

Business data is never deleted for a billing lapse.

## Billing owner

`tenants.billing_owner_profile_id` — a dedicated FK, not an RBAC permission (see `06-roles-permissions.md`). This is the account that retains access during suspension and receives payment-related notifications.

## Multi-currency — explicitly out of scope for now

`tenants.currency` is singular (tenant-level, not per-location), even though multi-location support exists in the schema from day one. Flagged as a scaling question to resolve explicitly before multi-location rollout expands beyond the current single-currency assumption — not silently baked in as permanent.

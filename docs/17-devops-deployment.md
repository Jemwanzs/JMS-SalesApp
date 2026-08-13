# 17 — DevOps & Deployment

## Stack

| Area | Technology |
|---|---|
| Source control | Git / GitHub (`Jemwanzs/JMS-SalesApp`) |
| Frontend hosting | Vercel |
| Backend / database | Supabase (Postgres, Auth, Storage) |
| Payments | Paystack |
| Email | Resend |
| Monitoring | Sentry |
| CI/CD | GitHub + Vercel (preview deployments per PR) |

## Branch strategy

```
main            production, protected, deploy-on-merge
development     integration branch
feature/*       one branch per feature (e.g. feature/sales-capture)
fix/*           bug fixes
```

Pull requests required before merging into `development` or `main`. `main` is production; Vercel deploys `main` to production and every open PR to its own preview URL.

## Environments

| Environment | Trigger | Supabase project | Notes |
|---|---|---|---|
| Development | Local (`npm run dev`) | Dev Supabase project, `.env.local` (never committed) | |
| Preview | Any open PR | Same dev Supabase project (or a Supabase preview branch, if enabled) | Lets reviewers click through a real deployment before merge |
| Production | Merge to `main` | Production Supabase project, separate credentials | |

## Secrets management

Never committed: `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_WEBHOOK_SECRET`, `RESEND_API_KEY`, `SENTRY_AUTH_TOKEN`. All live in Vercel's environment-variable store (scoped per environment) and local `.env.local`. `.env.example` documents every variable name with no real values — see the repo root. `.gitignore` excludes all `.env*` files except `.env.example` specifically.

## Database migration policy

Every structural database change is a numbered, sequential file in `supabase/migrations/` (e.g. `0001_core_tenancy_and_rbac.sql`, `0002_sales_engine.sql`). **No manual production schema changes** — a migration file is the only path from local dev to production. Migrations are never edited after being merged; a mistake is fixed with a new migration, not a rewrite of history.

## Deployment pipeline

```
Developer -> Feature branch -> GitHub PR -> Automated tests -> Vercel Preview
  -> Review -> Merge -> Production deployment
```

Production deployment only happens once the relevant migrations have been applied to the production Supabase project, tests pass, and required environment variables are confirmed present — never as a side effect of an unrelated merge.

## Monitoring

Sentry captures frontend errors, API errors, and (via server-side integration) failures in scheduled jobs. Specifically tracked: failed logins, slow queries, webhook failures, payment failures, scheduled-job failures, unusually high export activity, unusual security activity (spec §137).

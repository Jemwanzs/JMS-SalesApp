# JMS Sales App

Mobile-first, multi-tenant sales records & analytics platform. Next.js 15 (App Router, TypeScript) + Supabase (Postgres, Auth, Storage, RLS) + Paystack billing, deployed on Vercel.

Start with `docs/00-project-overview.md` — every other numbered doc under `docs/` covers one subsystem in depth (multi-tenancy, RBAC, sales engine, billing, security, deployment, and so on). `docs/20-development-progress.md` is the living build tracker; `docs/22-hardening-roadmap.md` tracks the current security/performance/completeness hardening pass.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in real values -- see the comments in that file
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app needs a real Supabase project to do anything useful (sign-up, sales capture, etc.) — there's no offline/mock mode.

## Database migrations

Schema lives in `supabase/migrations/*.sql`, applied in order. This project does not run migrations automatically — apply each new one manually via the Supabase Studio SQL Editor against the target project, then confirm it before continuing any dependent work. Never destructive by default (see each migration's own header comment); review before applying to a shared project.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Run a production build locally |
| `npm run lint` | ESLint (flat config) |
| `npx tsc --noEmit` | Type-check without emitting |

## Project structure

- `app/` — Next.js App Router routes, grouped by `(auth)`, `(tenant)`, `(platform-admin)`.
- `features/` — feature-scoped actions/components (server actions live in `features/*/actions/`).
- `services/` — the data-access layer; every Supabase query goes through a service class here, never directly in a component.
- `lib/` — cross-cutting helpers (permissions, Supabase client factories, date/timezone utilities).
- `supabase/migrations/` — the schema, in numbered order.
- `docs/` — the real documentation; read it before making architectural changes.

## Deployment

Vercel, auto-deployed from `main` (production) and `development` (preview). See `docs/17-devops-deployment.md` for environment variables, cron configuration, and the branch strategy.

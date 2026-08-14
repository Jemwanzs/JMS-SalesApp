# 07 — UI/UX & Screen Map

## Mobile-first, not "responsive" in the usual sense

The interface behaves like a mobile app on every device, per spec §2.1:

| Device | Behaviour |
|---|---|
| Mobile phone | Full-width responsive app |
| Tablet / laptop / desktop / ultra-wide | Mobile-width app (~430–480px) **centred**, neutral surrounding background |

The core operating interface never stretches into a traditional desktop dashboard. The surrounding desktop area may show branding, app version, and a QR link to open on mobile. This is implemented as a root layout constraint (`app/(tenant)/.../layout.tsx` and the equivalent auth/onboarding layouts wrap content in a max-width shell), not a per-page convention — so it can't be forgotten on a new page.

## Design principles

Minimal, fast, mobile-native, touch-friendly, professional, consistent, low cognitive load. Generous spacing, large tap targets, bottom sheets, cards, skeleton loaders, minimal long forms, sticky CTAs, meaningful empty states (spec §118–120).

## Typography & colour

- **Typeface**: Google Outfit, self-hosted via `next/font/google` (downloaded at build time, served from the app's own origin — no runtime font-CDN request, no CSP concerns). Set as `--font-sans` in `app/layout.tsx`, consumed globally through `app/globals.css`'s `@theme inline` mapping. Geist Mono remains the monospace face for tabular/numeric contexts (sale amounts, timestamps).
- **Background**: warm cream (`#FAF3E6` light / `#1B1611` dark) is the default page background everywhere (`--background` in `app/globals.css`), with white (`#FFFFFF` light / `#242019` dark) card/popover surfaces lifted on top of it. The desktop letterbox surround (outside the mobile-width column, see above) uses a deeper warm neutral (`--muted`, `#EFE6D3` light / `#2A241C` dark) rather than a cold grey, so it reads as one coherent warm palette rather than two clashing tones. Everything else (text, borders, the brand green accent from the logo) stays neutral/unchanged — this was a deliberately scoped background-only pass, not a full re-theme.

## Primary navigation (bottom nav, persistent)

```
Sales   Analytics   Reports   More
```

Inside **More**: Products, Sales History, Notifications, Settings, Help, Logout. Users only see modules permitted by their assigned permissions — the nav itself is permission-filtered, not just the destination page (spec §12).

## The golden path

Landing page after login is **Capture Sales**, never a dashboard:

```
Login -> Select Product -> Enter Amount -> Record Sale -> Return to Capture Sales
```

This is the north star for every UX decision in the Sales module — minimize taps, no unnecessary intermediate navigation, no "successful" state shown before server confirmation (see `08-sales-engine.md` for idempotency).

## Screen inventory (maps to `app/` route groups)

| Screen | Route group | Notes |
|---|---|---|
| Landing / marketing | `(marketing)` | Public, pre-auth |
| Login / Signup / Verify Email / Reset Password / Invite accept | `(auth)` | |
| Onboarding wizard (7 steps) | `(tenant)/onboarding` | Business details -> hours -> products -> import -> invite users -> subscription -> finish |
| Capture Sales | `(tenant)/t/[slug]/(dashboard)/sales` | Default landing after login |
| Sales History | same, sub-route | Permission-gated own vs. all |
| Analytics | `.../analytics` | KPI cards, product analytics, permission-gated date filters |
| Reports | `.../reports` | Daily/weekly/monthly/custom, corrections/void report |
| Products | `.../products` | List, drag-reorder, bulk upload |
| Users | `.../users` | Invite, role assignment, active/inactive |
| Security | `.../security` | Sessions, devices, geo-fencing, working hours, download security, MFA |
| Billing | `.../billing` | Plan, payment history, trial/grace status |
| Settings | `.../settings` | Business workspace, sales controls, numbering, notifications, locations, hours |
| Platform Admin shell | `(platform-admin)/admin` | Entirely separate nav, `is_platform_admin` guard — see `15-super-admin.md` |

## Sales capture screen

```
Good Morning, {name}
{Weekday, Date}
[ Search Products ]

Today's Products
[ image-card ] [ image-card ] ...
```

Product card, tenant-configurable display mode (spec §14):

- **Mode A**: image + name + expected price
- **Mode B**: image + name
- **Mode C**: image only

Tapping a product opens a bottom-sheet: image, name, expected price (reference only), Amount Sold, Quantity (togglable per tenant), Notes (optional), Cancel / Record Sale.

## Empty states

```
Today's Sales
KES 0
No sales recorded yet.
Your numbers will appear here after the first sale.
```

Applies per-product too (`Coffee — KES 0 today`). Never an empty grey box with no explanation.

## Confirmation-required actions

Close Day, Reopen Day, Void Sale, Disable User, Change Role, Suspend Tenant, Export Sensitive Report, Access Tenant Workspace (platform admin) — all require an explicit confirm step, most with a required reason field (spec §122).

## Internationalization

`next-intl` scaffolded from Phase 1f. Each user selects their own language independently of the tenant default; changing one user's language never affects the tenant or any other user (spec §62) — implemented via the config cascade in `04-multi-tenancy.md`.

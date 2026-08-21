# Android Advisory — JMS Sales App

*Status: **advisory only**. Nothing in this document has been implemented. This is the plan to follow **when** we decide to build the Android app, not a build log. Written 2026-08-22 — re-check the time-sensitive notes in §12 before starting, since Play Store policy deadlines move.*

---

## 1. Bottom line

We do **not** need to rewrite JMS Sales App to put it on Google Play. The app is already a mobile-first Next.js + Supabase web application (see `docs/00-project-overview.md`, `docs/07-ui-ux-screen-map.md`) — the entire UI is already built for a ~430px phone-width column. The right move is to wrap the *existing* frontend in a native Android shell with **Capacitor**, not to rebuild it in React Native/Flutter, and not to dump the Vercel URL into a plain WebView.

**Do not scope this as** "convert the website to an APK."
**Scope it as**: *Mobile Application Production Readiness & Google Play Deployment* — Capacitor integration, native navigation/back-button behaviour, auth deep-linking, splash/icon assets, session persistence, secure API handling, push notifications, file handling, Android permissions, privacy/account-deletion compliance, device testing, release signing, Play Console setup, closed testing, production deployment.

---

## 2. What stays exactly as it is

Nothing about the current architecture changes. The Android app becomes a **second client** of the same backend, sitting alongside the existing Vercel-hosted web app:

```
                    ┌─────────────────────┐
                    │       GitHub        │
                    │  Single codebase    │
                    │  (jms-sales-app)    │
                    └─────────┬───────────┘
                              │
                    Next.js 15 App Router / TS
                              │
              ┌───────────────┴──────────────┐
              │                               │
              ▼                               ▼
      ┌───────────────┐               ┌────────────────┐
      │     Vercel     │               │   Capacitor    │
      │    Web App      │               │ Android App    │
      │ jms-sales.vercel │              │ (android/ dir) │
      │      .app        │              └────────┬───────┘
      └───────┬───────┘                          │
              │                                   ▼
              │                           Google Play Store
              │                                   │
              └───────────────┬───────────────────┘
                              ▼
                      ┌───────────────┐
                      │   Supabase    │
                      │ Auth          │
                      │ Postgres      │
                      │ Storage       │
                      │ RLS (has_permission)
                      └───────┬───────┘
                              │
                ┌─────────────┼──────────────┐
                ▼             ▼              ▼
          Transactional   Paystack        FCM
           email (Auth     Billing      (push, new)
            built-in)
```

Concretely, in this repo, that means:

- Every service in `services/*.ts` (RLS-respecting client + the documented service-role allow-list in `lib/supabase/service-role.ts`) is untouched.
- Every RLS policy and the `has_permission()` SQL function (`supabase/migrations/0001_core_tenancy_and_rbac.sql` onward) keeps enforcing tenant isolation exactly as it does today — the Android client is just another caller of the same Supabase project with the same anon key + RLS boundary.
- Billing stays on Paystack (`docs/14-billing-paystack.md`) — nothing about `BillingService`/the webhook route changes.
- Vercel keeps serving the web app at its current URL. The mobile app does **not** replace it.

---

## 3. The one addition to the repo: a native Android project

Capacitor adds a real native Android project alongside the existing app, not a build step that consumes it:

```
JMS_Sales_App/
├── app/                  (unchanged — Next.js App Router)
├── components/           (unchanged)
├── features/             (unchanged)
├── services/             (unchanged)
├── supabase/              (unchanged)
├── docs/                 (unchanged, this file lives here)
│
├── android/               ← NEW — a real Android Studio project
├── capacitor.config.ts    ← NEW
└── package.json           (adds @capacitor/core, @capacitor/android, etc.)
```

Day-to-day development stays: **VS Code → Claude Code → GitHub → Supabase/Vercel**, exactly as now. Android Studio only enters the loop for packaging, native testing, and release builds:

```
VS Code / Claude Code  →  GitHub  →  Supabase / Vercel      (unchanged, daily)
        │
        └── when preparing an Android release ──▶ Android Studio → .aab → Play Console
```

**Why Capacitor over React Native/Flutter**: this app's entire UX has already been built mobile-first inside a real browser engine (Tailwind, shadcn/base-ui, the existing `contain-layout` / `max-w-[430px]` shell conventions documented in `docs/07-ui-ux-screen-map.md`). Capacitor reuses all of that directly and adds native device APIs on top (camera, share, biometrics, push, file downloads) without a UI rewrite. React Native/Flutter would mean re-implementing every screen this session already built — Products, Capture Sales, Sales History, Analytics (including the Gold/Silver/Bronze product **and** user performance rankings), Reports, the Daily Sales PDF, Billing, Security, the whole `More` menu — in a second UI framework, for no real benefit at this stage. Revisit React Native/Flutter only if a future need for a *substantially different* native UI actually arises — not by default.

---

## 4. Authentication: the one real code change needed

Everything in `services/AuthService.ts` keeps working as-is. The one adjustment is **redirect targets** for flows that currently bounce through a browser.

Today (all real, current routes in this repo):

| Flow | Current web redirect |
|---|---|
| Email confirmation | `${NEXT_PUBLIC_APP_URL}/api/auth/callback?next=/login` (`AuthService.signUp`) |
| Password reset | caller-supplied `redirectTo` → `app/(auth)/reset-password/confirm/page.tsx` |
| Invite acceptance | caller-supplied `redirectTo` → `app/(auth)/invite/confirm/page.tsx` (`UserService.inviteUser`) |

For the Android app, add a **deep-link scheme** (e.g. `jmssales://auth/callback`) registered in the Android manifest via Capacitor, and pass that as the `redirectTo`/`emailRedirectTo` when the request originates from the native app instead of the browser. Supabase Auth officially supports redirecting to a custom scheme this way — no backend change, just a different redirect URL depending on which client initiated the flow.

Result: install the app → sign up → tap the confirmation email → the **Android app itself** opens and completes confirmation, instead of dumping the user into Chrome.

This needs testing against every flow already covered in `docs/05-authentication-security.md`: email confirmation, password reset, invite acceptance. Magic links / OAuth aren't in use today, so no work needed there unless that changes first.

---

## 5. Secrets: nothing privileged ships in the APK/AAB

This is already this codebase's own discipline (`lib/supabase/service-role.ts`'s documented allow-list, `AGENTS.md`'s secret-handling conventions) — it just needs to be repeated explicitly for a native build, because a compiled Android app is trivially decompilable:

**Never bundle into the Android app:**
- `SUPABASE_SERVICE_ROLE_KEY`
- Paystack secret key / webhook secret
- Any future email-provider API key (Resend or otherwise)
- Any signing keystore or its password (see §14)

**Safe to ship in the client** (same as the web app today): `NEXT_PUBLIC_SUPABASE_URL`, the Supabase **anon/publishable** key — safe specifically *because* RLS is the real enforcement boundary, not client-side trust, exactly as documented in `docs/02-system-architecture.md`.

The rule stays identical to the one already governing this repo: anything gated through `createServiceRoleClient()` stays server-side (a Vercel route/server action), never callable directly from the Android client.

---

## 6. Tooling: install Android Studio, keep VS Code for everything else

Android Studio is needed for: SDK management, the emulator, physical-device testing, app icon/splash configuration, `AndroidManifest.xml`, build config, signing, and producing the final `.aab`. It does **not** replace VS Code/Claude Code for actual feature development — think of it as a packaging and release tool that sits downstream of the same GitHub repo.

---

## 7. App identity (decide once, permanent)

Google Play treats the application ID as a **permanent** identifier — it cannot be changed after first publish. Suggested values, matching branding already established in this repo (the User Guide PDF footer, `docs/USER_GUIDE.md`):

| Field | Suggested value |
|---|---|
| App name | `JMS Sales App` (matches `package.json` name and every page `<title>` already in the app) |
| Package / Application ID | `com.syncscore.jmssales` (or `com.syncscore.salesmanager` if the public-facing name changes before launch) |
| Developer | SyncScore Ltd (see §11 — register as an organization, not a personal account) |
| Version name | `1.0.0` (SemVer-ish, human-facing) |
| Version code | `1`, incrementing by 1 on every release regardless of version name |

Decide the package ID **before** the first Play Console upload, not after.

---

## 8. Mobile production-readiness audit (do this before touching Play Console)

Most of this app's mobile-first work is already done this session (the `contain-layout` mobile-shell pattern, the bottom nav, the responsive audits already performed on the platform-admin shell and tenant dashboard). Before an Android release specifically, re-audit for **native-app** behaviour, which is a different bar than "looks fine in a phone-width browser tab":

- No horizontal scrolling anywhere (already a recurring theme of this session's UI fixes — re-verify, don't assume).
- Keyboard behaviour: inputs stay visible/scrolled-into-view when the on-screen keyboard opens (a common WebView-in-native gap).
- Bottom navigation doesn't collide with Android's own gesture bar / back button.
- The Android hardware/gesture **back button** does the right thing at every screen (closes a dialog first, then navigates back, never exits the app unexpectedly from a dialog).
- Dialogs/Sheets fit small screens without clipping (this repo already has the `#app-shell` / `contain-layout` portal-containment pattern from `components/ui/dialog.tsx` and `sheet.tsx` — confirm it still behaves correctly inside a Capacitor WebView, not just a mobile browser).
- Touch targets are comfortably sized (already addressed for dialog/sheet close buttons this session — re-check newly added UI as it ships).
- File upload (product images), the products bulk-upload template download, and the Daily Sales PDF download/share (`features/sales/components/daily-report-dialog.tsx`) all need explicit native-file-handling verification — a plain `<a download>` behaves differently inside a WebView than a real browser tab.
- Camera/photo picker for product images, if that flow is extended to use the device camera directly (a natural Capacitor addition, not present today).
- Date pickers render/behave correctly (native `<input type="date">` rendering varies by WebView).
- Session persistence: the app must **not** silently log a user out when Android reclaims the app from the background — verify Supabase's session storage survives a real Android process kill/restore cycle, not just a page refresh.
- Tenant isolation remains intact under the native shell — this is an RLS guarantee, not a UI one, so it should already hold, but confirm nothing about the native container changes how cookies/session tokens are stored.
- Splash screen + app icon: a simple branded splash (`SyncScore Ltd` attribution, matching the User Guide PDF's own footer branding) and a proper adaptive icon set.

---

## 9. Push notifications (new capability, optional but high-value)

Email (today: Supabase Auth's own transactional email, no separate provider wired up yet — see §4) stays for confirmations/invites/resets. Push notifications are a **genuinely new channel** the Android app unlocks, not a replacement for anything existing:

- "Grace recorded KES 45,000 in sales today."
- "Today's sales target is 78% complete."
- "Bob is currently the top-performing agent this week." — this pairs naturally with the Gold/Silver/Bronze **User Performance** ranking already shipped in Analytics this session.
- "Your subscription expires in 3 days." — pairs with the existing Billing/trial-status logic in `BillingService`.

Standard approach: **Firebase Cloud Messaging (FCM)** for Android push delivery. This does **not** mean migrating any data to Firebase — Supabase remains the single source of truth for auth/database/storage; FCM is purely a delivery channel, triggered from a server-side function (a new Vercel route or Supabase Edge Function) that already has access to the same data everything else in this app already queries.

---

## 10. Google Play policy: mandatory product work before submission

Two things become **required product features**, not optional polish, the moment account creation exists in a Play Store app:

**Account deletion** — Google requires both an in-app path and a public web page. For a multi-tenant app like this one, the distinction matters and needs real thought before building it:

- An **invited employee** deleting their own account must never delete the tenant/business.
- A **Tenant Administrator / billing owner** deleting their account needs a clearly separate, more consequential flow (likely: "Delete My Account" vs. "Delete This Business" as genuinely different actions with their own confirmations) — this needs a real decision on what happens to the tenant's sales history, other members, and active subscription when an owner requests deletion. Don't build this without that decision made first.
- A public page is needed: `yourdomain.com/account-deletion`, describing how to request deletion even without installing the app.

**Privacy Policy + Data Safety declaration** — required, and must accurately describe what this specific app actually collects: names, emails, business/tenant information, sales records, employee activity/performance data (now including the User Performance rankings), device information if collected, and every third-party processor involved — **Supabase, Vercel, Paystack**, and whichever email provider is in use at launch time (today: Supabase Auth's built-in email; update this doc if that changes). Needs public pages: `/privacy-policy`, `/terms-of-service`, `/account-deletion`, `/support`.

Both of these should be scoped as real feature work with their own planning pass when this project actually starts — not squeezed in during Play Console setup.

---

## 11. Google Play Console: developer account

Register as an **Organization**, not a personal account — this is a commercial SaaS product under a real technology company (SyncScore Ltd, already the attribution used throughout this app's own User Guide PDF). The store listing then correctly shows "Developer: SyncScore Ltd" rather than a personal Google account name. Google requires developer verification information for this either way; decide organization-vs-personal **before** starting registration, since it affects the testing-track requirements in §13.

---

## 12. Store listing & marketing assets

Inside Play Console: **Create app** → app name, default language, category (**Business**), free/paid status, contact details.

Assets needed:
- App icon (the existing JMS logo mark, already used throughout the app and the User Guide PDF cover).
- A feature graphic banner — something like *"Capture. Monitor. Understand Your Sales."*
- Phone screenshots — this repo already has a proven, repeatable way to capture real, populated screens for exactly this purpose: the seeded-demo-tenant + Playwright walkthrough process used to build `docs/USER_GUIDE.md`'s screenshots (`scripts/build-user-guide-pdf.mjs`'s own header comment documents the pattern). Reuse that process for Play Store screenshots directly instead of inventing a new one. Suggested screens, matching what's actually in the app today:
  1. Capture Sales — "Capture sales in seconds"
  2. Sales History — "Every sale, always traceable"
  3. Analytics (Product Performance) — "Know what's performing"
  4. Analytics (User Performance) — "Recognize your best salespeople"
  5. Products — "Your catalog, always up to date"
  6. Daily Sales Report PDF — "Turn sales into insights, instantly"

---

## 13. Build, signing, and testing

**Build pipeline**: source → `npm run build` → `npx cap sync android` → Android Studio → signed release build → `app-release.aab` → Play Console. The artifact Play Console wants is the `.aab`, not a Vercel deployment URL.

**Signing**: production builds must be signed. Use **Google Play App Signing** and protect the upload key carefully — a keystore, its alias, and its passwords. **Never commit** `*.jks`, `keystore.properties`, or any signing password to the repo (this repo's `.gitignore` already excludes `.env*` for the equivalent web-side concern — extend that same discipline to signing credentials when the `android/` directory is added).

**Testing tracks**: Internal → Closed → Open → Production. Plan an initial closed/internal round with real internal users (matching this app's own existing users) covering, at minimum, everything already built and verified this session: signup, login, password reset, invite a user, invite acceptance, record a sale (including the "Others" catch-all product flow), product search, Sales History defaulting to today, Analytics (both Product and User Performance tabs), the Daily Sales PDF, Billing/subscription, account deactivation, logout/re-login, and session persistence across app backgrounding.

**Important timing constraint**: for personal developer accounts created after **November 13, 2023**, Google requires a closed test with **at least 12 testers, continuously opted in for 14 days**, before production access is granted. This is another reason §11's organization-account decision should be made early — verify the current requirement against Google's own published policy at the time this work actually starts, since Play policy specifics do shift.

---

## 14. Target SDK — time-sensitive, check before starting

As of when this document was written (2026-08-22), Google requires new apps and updates submitted to Google Play to **target Android 16 / API level 36** starting **August 31, 2026**. Build directly against `targetSdk = 36` from day one rather than an older target that would immediately need an upgrade. **Re-verify this against Google's current published policy before starting the Android project** — this exact number and date should be treated as "true as of when this was written," not assumed permanently current.

---

## 15. Full submission flow (for reference)

```
Developer Account (Organization: SyncScore Ltd)
      │
      ▼
Create App
      │
      ▼
Developer verification
      │
      ▼
Store listing + assets (§12)
      │
      ▼
Privacy Policy + Data Safety + App Content declarations (§10)
      │
      ▼
Upload signed .aab (§13)
      │
      ▼
Internal / Closed testing (§13)
      │
      ▼
Fix issues found in testing
      │
      ▼
Production release submitted for Google review
      │
      ▼
LIVE ON GOOGLE PLAY
```

---

## 16. iOS, later

The same Capacitor approach extends to an `ios/` directory for the Apple App Store later, without a second full rewrite — worth knowing now, not something to plan in detail until the Android release is stable.

---

## 17. Pre-flight checklist (when this actually starts)

- [ ] Confirm the package ID (§7) — permanent once published.
- [ ] Decide organization vs. personal Play developer account (§11) — affects testing requirements (§13).
- [ ] Decide the account-deletion product behaviour for tenant owners vs. invited employees (§10) — plan this as real feature work before building it.
- [ ] Write and publish `/privacy-policy`, `/terms-of-service`, `/account-deletion`, `/support` (§10).
- [ ] Add Capacitor + `android/` to this repo; wire deep-link auth redirects (§4).
- [ ] Run the full mobile production-readiness audit (§8) as its own pass — expect it to surface real fixes, not just checkbox items.
- [ ] Decide whether push notifications (§9) ship in v1 or a fast-follow.
- [ ] Re-verify the target-SDK deadline (§14) and the closed-testing tester/duration requirement (§13) against Google's current policy before scheduling a release date.
- [ ] Reuse `scripts/build-user-guide-pdf.mjs`'s demo-tenant screenshot pattern for Play Store screenshots (§12).
- [ ] Confirm signing-credential handling never touches the public repo (§13).

---

*Cross-references in this repo: `docs/00-project-overview.md`, `docs/02-system-architecture.md`, `docs/05-authentication-security.md`, `docs/07-ui-ux-screen-map.md`, `docs/14-billing-paystack.md`, `docs/19-security-checklist.md`, `docs/USER_GUIDE.md`, `lib/supabase/service-role.ts`.*

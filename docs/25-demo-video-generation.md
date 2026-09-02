# 25 — Demo Video Generation

A repeatable pipeline that produces `public/demo-video-v1.mp4`: a silent,
~1:40 portrait walkthrough of a Sales Agent's daily workflow (record a
sale, review History, Analytics, Reports, and the product catalogue via
More), presented inside a generic phone bezel with tap-ripple indicators
and progressively-typed instructional captions in place of a voice-over.
Linked from the Login page ("Watch: Demo Video", downloadable, next to
the existing User Guide link).

## Why it's built this way

- **Real UI, not a mock-up.** The video is a genuine Playwright
  recording of the live app driving real clicks through real routes —
  nothing about the workflow is staged or drawn separately.
- **The demo tenant only.** Records against MaliSafi Groceries Ltd
  (docs/24 references the platform's demo-tenant precedent) — never a
  real tenant's data.
- **Credentials never touch the video, or the repo.** The visible
  recording starts already logged in — an off-screen pass authenticates
  first and hands the resulting session to the recorded browser context
  via `storageState`, so the login form and its credentials never
  appear on screen. Credentials load only from `.env.local` (gitignored;
  see `.env.example` for the documented placeholder keys) and are never
  hardcoded in any committed script.
- **No production code changes to make the video work.** The phone
  bezel, tap ripples, and captions are all recording-only presentation
  chrome — either composited in post (the bezel) or injected into the
  page at runtime by the recording script (the overlay), never added to
  `app/`, `features/`, or anything that ships to real users.
- **No external/licensed assets.** The phone bezel is drawn from scratch
  as a generic rounded rectangle (not modeled on any specific real
  device), and the tap sound is synthesized by ffmpeg rather than
  sourced from an audio library — nothing here carries a licensing
  question.

## Pipeline

```
scripts/demo-video/
  frame-template.html     -- the phone bezel, as an SVG mask (see its own header comment for the geometry)
  generate-frame.mjs      -- one-off: renders frame-template.html -> assets/phone-frame.png (run again only after editing the geometry)
  assets/phone-frame.png  -- committed; the transparent-screen bezel PNG generate-frame.mjs produces
  overlay.js              -- injected at runtime: window.__demo.caption()/hideCaption()/ripple()
  record.mjs              -- drives the real walkthrough, records raw.webm + clicks.json (both gitignored, regenerated each run)
  compose.mjs             -- composites raw.webm into the bezel + synthesizes tap sounds -> public/demo-video-v1.mp4 (committed)
```

Regenerate the whole video after a UI change:

```bash
# 1. Start the app the recording will drive
npm run dev            # or: npm run build && npm run start (recommended -- see "next dev vs next build" below)

# 2. Record (from a second terminal)
node scripts/demo-video/record.mjs

# 3. Composite into the final MP4
node scripts/demo-video/compose.mjs
```

`compose.mjs` overwrites `public/demo-video-v1.mp4` in place — commit
the updated file the same way any other change is committed.

`generate-frame.mjs` only needs to be re-run if you edit
`frame-template.html` itself (the bezel shape/size) — it isn't part of
the normal regeneration loop.

### `next dev` vs a production build

`record.mjs` works against `next dev`, but two dev-only quirks are worth
knowing:

- The first visit to each route triggers on-demand compilation, adding
  several seconds of real latency to that transition. `record.mjs`'s
  own `waitForLoadState("networkidle")` absorbs this correctly, but the
  video's pacing will look snappier if you warm every route once first
  (`curl` each page, or just click through manually) or record against
  `next build && next start` instead.
- `next dev`'s build-activity indicator (`<nextjs-portal>`) sits on top
  of the page with an invisible full-viewport hit area and intercepts
  clicks. `record.mjs` strips it before every tap defensively
  (`stripDevOverlay`) — this is dev-only and won't exist against a
  production build at all.

## Editing wording, timing, or the sequence

Everything is in `record.mjs`'s `runSteps()` function, top to bottom in
the order it plays:

- **Caption text** — the string literal passed to each `say(page, "...")` call.
- **Pacing** — the constants at the top of the file: `READ_MS` (pause
  held after a caption finishes typing, before the action), `OBSERVE_MS`
  (pause after a screen loads, before the next caption), `NAV_SETTLE_MS`
  (pause right after a tap, before checking what loaded). Per-step
  overrides are passed as `{ readMs: ... }` / an explicit `observe(page, ms)`
  call where a screen needs longer (e.g. Analytics gets `OBSERVE_MS + 1200`
  so the KPIs are readable).
- **Sequence/steps** — reorder, add, or remove whole blocks in
  `runSteps()`. Each block follows the same shape: a caption, a
  `tapLocator(page, someLocator)` (which ripples then clicks), then a
  wait for the destination to settle.
- **Which account records it** — `DEMO_VIDEO_EMAIL`/`DEMO_VIDEO_PASSWORD`
  in `.env.local`. **Must be an account with `reports.view`** (Supervisor
  or above) — a plain Sales User role has no Reports or Stock tab at all
  (docs/06-roles-permissions.md), so it can't complete the Reports step.

## Security

- `DEMO_VIDEO_EMAIL` / `DEMO_VIDEO_PASSWORD` / `DEMO_VIDEO_BASE_URL` live
  only in `.env.local` (gitignored) — `.env.example` documents the keys
  with empty placeholder values, never real ones.
- The visible recording starts post-login (see "Why it's built this
  way" above) — the login screen, the password field, and any session
  token are never rendered in a frame that gets recorded.
- `record.mjs` only ever authenticates as the one demo account named in
  those env vars — there is no code path that could record a different
  tenant's data.

## Regenerating after the app changes

Because `record.mjs` drives real selectors (`data-tour-id`,
`aria-label`, role/name locators — the same attributes the Guided
Onboarding Tour already relies on, see `hooks/tour-context.tsx`), a
route or component rename that changes one of those will break the
recording the same way it would break the tour. Re-run `record.mjs`
after any Sales/History/Analytics/Reports/More/Products UI change and
watch it complete without a Playwright timeout as the smoke test.

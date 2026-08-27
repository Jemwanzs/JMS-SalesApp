import { defineConfig, devices } from "@playwright/test";

/**
 * Hardening roadmap Phase 5.2 (docs/22-hardening-roadmap.md): smoke
 * tests only, deliberately -- no Supabase calls, so CI never touches
 * real production data. These verify the build actually boots and the
 * public, unauthenticated surface (login, signup, legal pages, the app
 * shell) renders -- catching a broken deploy, not a broken feature.
 * Real golden-path tests (sign up, log in, record a sale) would need a
 * dedicated test Supabase project, which doesn't exist yet -- explicit
 * scope decision, not an oversight (see the roadmap doc).
 *
 * webServer reuses whatever `next build` already produced in the same
 * CI job (Phase 2.7's existing build step) rather than rebuilding --
 * `next start` just serves it. Same placeholder NEXT_PUBLIC_* env vars
 * as that build step; nothing here ever reaches Supabase.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      // Chromium + a manual 390x844 viewport (not the iPhone-13 device
      // preset -- that forces WebKit, a second browser engine to
      // install for no real benefit here). 390x844 is deliberate: this
      // app is mobile-first throughout (docs/00-project-overview.md),
      // and its real content width caps at ~430px regardless of
      // device, so this is the actual target, not an arbitrary choice.
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

import { test, expect, type Page } from "@playwright/test";

/**
 * Hardening roadmap Phase 5.2 (docs/22-hardening-roadmap.md). Scoped
 * to pages that build fully static (confirmed via `next build`'s own
 * route summary -- these are pre-rendered at build time, so they never
 * make a server-side Supabase call at request time) -- safe to run in
 * CI against the placeholder NEXT_PUBLIC_SUPABASE_URL the build step
 * already uses, with zero risk of ever reaching real Supabase. This is
 * a deploy-health check, not a feature test: it proves the build boots
 * and the public surface renders, not that sign-up/login actually work
 * end-to-end (that needs a real backend -- see the roadmap doc's Phase
 * 5.2 entry for why that's explicitly out of scope here).
 */

/**
 * AuthPromoBanner (components/shared/auth-promo-banner.tsx) auto-opens
 * full-screen on /login and /signup for a fresh visitor -- real,
 * intentional product behavior (visits 1-3 auto-open, per that
 * component's own header comment), not a bug. Every Playwright test
 * starts with empty localStorage, so it always looks like a first
 * visit; close it before interacting with anything it would otherwise
 * cover, the same way a real first-time user would.
 */
async function closePromoBannerIfPresent(page: Page): Promise<void> {
  // A one-shot isVisible() check races the banner's own useEffect (it
  // renders nothing until that effect resolves client-side after
  // mount) -- an instant "not visible yet" reads as "never showing" and
  // the banner then appears moments later, after this already moved
  // on. Attempting the click itself with a bounded wait lets Playwright
  // retry until the button actually exists, and simply passes through
  // if it genuinely never appears.
  await page
    .getByRole("button", { name: "Close" })
    .click({ timeout: 5000 })
    .catch(() => {});
}

test.describe("public marketing pages", () => {
  test("privacy policy renders", async ({ page }) => {
    await page.goto("/privacy-policy");
    await expect(page.getByRole("heading", { name: "Privacy Policy", level: 1 })).toBeVisible();
    await expect(page.getByRole("contentinfo").getByText("SyncScore Ltd")).toBeVisible();
  });

  test("terms of service renders", async ({ page }) => {
    await page.goto("/terms-of-service");
    await expect(page.getByRole("heading", { name: "Terms of Service", level: 1 })).toBeVisible();
  });

  test("support page renders and links the user guide", async ({ page }) => {
    await page.goto("/support");
    await expect(page.getByRole("heading", { name: "Support", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Download the User Guide/i })).toBeVisible();
  });

  test("marketing pages cross-link to each other", async ({ page }) => {
    await page.goto("/privacy-policy");
    await page.getByRole("link", { name: "Terms of Service" }).first().click();
    await expect(page).toHaveURL(/\/terms-of-service$/);
  });
});

test.describe("auth pages", () => {
  test("login page renders the sign-in form", async ({ page }) => {
    await page.goto("/login");
    await closePromoBannerIfPresent(page);
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /log in|sign in/i })).toBeVisible();
  });

  test("signup page renders the sign-up form and legal links", async ({ page }) => {
    await page.goto("/signup");
    await closePromoBannerIfPresent(page);
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Terms of Service" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  });

  test("login and signup link to each other", async ({ page }) => {
    await page.goto("/login");
    await closePromoBannerIfPresent(page);
    await page.getByRole("link", { name: /sign up/i }).click();
    await expect(page).toHaveURL(/\/signup$/);
  });
});

test.describe("app shell", () => {
  test("manifest is served and installable", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBeTruthy();
    const manifest = await response.json();
    expect(manifest.name).toBe("JMS Sales App");
    expect(manifest.display).toBe("standalone");
  });

  test("no unhandled console errors on the login page", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });
});

// Records the raw (un-framed) Sales Agent walkthrough -- see
// docs/25-demo-video-generation.md for the full pipeline and how to
// edit the wording/timing below. Run: node scripts/demo-video/record.mjs
// Produces scripts/demo-video/output/raw.webm and clicks.json (a
// sidecar of {tMs} timestamps compose.mjs uses to place the tap-sound
// cues). Feed the result through compose.mjs to get the final framed,
// sound-added MP4.
//
// Credentials come ONLY from env vars (DEMO_VIDEO_EMAIL/PASSWORD/
// BASE_URL in .env.local, gitignored, never committed -- see
// .env.example for the documented placeholder) -- never hardcoded here.
// Must be an account with reports.view (Supervisor or above) -- a plain
// Sales User role has no Reports/Stock tab at all (docs/06-roles-
// permissions.md), so it can't complete the Reports step this
// walkthrough demonstrates.
// The visible recording starts already logged in (storageState
// captured from an off-screen auth pass) so the login screen and its
// credentials are never part of the video at all.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_DIR = path.join(__dirname, "output");
const OVERLAY_JS = readFileSync(path.join(__dirname, "overlay.js"), "utf8");

function loadEnv() {
  const envPath = path.join(ROOT, ".env.local");
  const env = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
  return env;
}

const env = loadEnv();
const EMAIL = env.DEMO_VIDEO_EMAIL;
const PASSWORD = env.DEMO_VIDEO_PASSWORD;
const BASE = env.DEMO_VIDEO_BASE_URL || "http://127.0.0.1:3000";
if (!EMAIL || !PASSWORD) {
  throw new Error("DEMO_VIDEO_EMAIL / DEMO_VIDEO_PASSWORD are not set in .env.local -- see .env.example.");
}

const SCREEN = { width: 390, height: 844 };

// --- Pacing knobs (spec: "2-4s reading -> tap -> load -> 1-3s observe")
// Tune these, and the caption strings in runSteps() below, to change
// the video's wording/speed without touching the recording mechanics
// above. See docs/25-demo-video-generation.md for the full guide.
const READ_MS = 2600; // extra pause held AFTER a caption finishes typing, before acting
const OBSERVE_MS = 2200; // pause after a screen loads, before the next caption starts
const NAV_SETTLE_MS = 1200;

let clickLog = [];
let recordingStartedAt = 0;

async function injectOverlay(page) {
  await page.addScriptTag({ content: OVERLAY_JS });
  // next dev's own build-activity indicator (<nextjs-portal>, dev-mode
  // only -- absent from a production build) sits on top of everything
  // with an invisible full-viewport hit area and intercepts every
  // click. Recording against `next build && next start` avoids this
  // entirely (see docs/25-demo-video-generation.md); stripping the
  // element here keeps `next dev` usable for quick local iterations.
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
  });
}

async function say(page, text, { readMs = READ_MS } = {}) {
  await page.evaluate((t) => window.__demo.caption(t), text);
  await page.waitForTimeout(Math.max(1200, text.length * 28)); // typing itself
  await page.waitForTimeout(readMs);
}

async function hideCaption(page) {
  await page.evaluate(() => window.__demo.hideCaption());
}

async function stripDevOverlay(page) {
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
  }).catch(() => {});
}

async function tapLocator(page, locator) {
  await stripDevOverlay(page);
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("tapLocator: element has no bounding box (not visible?)");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(([x, y]) => window.__demo.ripple(x, y), [x, y]);
  await page.waitForTimeout(420); // let the ripple be visible before the real click
  await stripDevOverlay(page);
  await locator.click();
  clickLog.push({ tMs: Date.now() - recordingStartedAt });
  await page.waitForTimeout(NAV_SETTLE_MS);
}

async function observe(page, ms = OBSERVE_MS) {
  await page.waitForTimeout(ms);
}

async function dismissBanners(page) {
  const closeBtn = page.getByRole("button", { name: /close/i });
  if (await closeBtn.first().isVisible({ timeout: 800 }).catch(() => false)) {
    await closeBtn.first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function runSteps(page) {
  const tenantSlug = page.url().match(/\/t\/([^/]+)\//)[1];

  await injectOverlay(page);
  await dismissBanners(page);

  // --- 1. Welcome ---------------------------------------------------
  await say(page, "Welcome to your Daily Sales");
  await say(page, "Your available products are displayed here.");

  // --- 2. Record a sale ----------------------------------------------
  await say(page, "To record a sale, locate the product sold and tap +.");
  const firstRow = page.locator('[data-tour-id="record-sale-target"]');
  const plusButton = firstRow.getByRole("button", { name: /^record a sale for/i });
  await tapLocator(page, plusButton);
  await hideCaption(page);

  try {
    await page.waitForSelector("#amount", { timeout: 10000 });
  } catch (err) {
    await page.screenshot({ path: path.join(OUTPUT_DIR, "dialog-debug.png") });
    console.error("Record-sale dialog never opened -- see output/dialog-debug.png");
    throw err;
  }
  await observe(page, 1000);

  const unitPrice = Number(await page.locator("#amount").inputValue());

  await say(page, "Enter the quantity sold, then confirm the total amount.");
  const qtyInput = page.locator("#quantity");
  if (await qtyInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await qtyInput.click();
    await qtyInput.fill("");
    await qtyInput.pressSequentially("2", { delay: 140 });
    if (Number.isFinite(unitPrice) && unitPrice > 0) {
      const amountInput = page.locator("#amount");
      await amountInput.click();
      await amountInput.fill("");
      await amountInput.pressSequentially(String(Math.round(unitPrice * 2 * 100) / 100), { delay: 90 });
    }
    await observe(page, 900);
  }
  await hideCaption(page);

  await say(page, "Tap Record Sale to confirm the transaction.");
  const submitBtn = page.getByRole("button", { name: /^record sale$/i });
  await tapLocator(page, submitBtn);
  await hideCaption(page);

  await page.getByText(/sale recorded/i).first().waitFor({ timeout: 10000 }).catch(() => {});
  await say(page, "Sale recorded successfully.");
  await hideCaption(page);

  // --- 3. History ------------------------------------------------------
  await say(page, "Use History to review sales that have already been recorded.");
  await tapLocator(page, page.locator('[data-tour-id="tour-nav-sales-history"]'));
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await injectOverlay(page);
  await observe(page);
  await hideCaption(page);

  // --- 4. Analytics ------------------------------------------------
  await say(page, "Analytics helps you understand sales performance and trends.");
  await tapLocator(page, page.locator('[data-tour-id="tour-nav-analytics"]'));
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await injectOverlay(page);
  await observe(page, OBSERVE_MS + 1200);
  await hideCaption(page);

  // --- 5. Reports ------------------------------------------------
  await say(page, "Use Reports to view detailed sales summaries and performance information.");
  await tapLocator(page, page.locator('[data-tour-id="tour-nav-reports"]'));
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await injectOverlay(page);
  await observe(page, OBSERVE_MS + 1000);
  await hideCaption(page);

  // --- 6. More -> Available Products ------------------------------
  await say(page, "The More menu gives you access to additional tools and information.");
  await tapLocator(page, page.locator('[data-tour-id="tour-nav-more"]'));
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await injectOverlay(page);
  await observe(page, 1400);
  await hideCaption(page);

  await say(page, "Here you can see the products currently available for recording sales.");
  const productsLink = page.getByRole("link", { name: /^products$/i }).first();
  await tapLocator(page, productsLink);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await injectOverlay(page);
  await hideCaption(page);
  await observe(page, 800);
  await page.mouse.wheel(0, 500);
  await observe(page, 1600);

  // --- 7. End screen -------------------------------------------------
  await say(page, "You're ready to start recording your daily sales.", { readMs: READ_MS + 1200 });
  await hideCaption(page);
  await observe(page, 800);

  void tenantSlug;
}

async function main() {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();

  // --- Off-screen auth pass: never recorded, so the credentials and
  // the login form itself never appear in the finished video. ---
  const authContext = await browser.newContext({ viewport: SCREEN });
  await authContext.addInitScript(() => {
    try {
      window.localStorage.setItem(
        "cookie-consent",
        JSON.stringify({ essential: true, analytics: false, timestamp: new Date().toISOString() })
      );
      // AuthPromoBanner (components/shared/auth-promo-banner.tsx) opens
      // automatically on visits 1-3 of a fresh browser -- always true for
      // a scripted context with empty localStorage, and it fully covers
      // the login form. Pre-seeding a high visit count keeps it collapsed
      // so it can never race with the login click below.
      window.localStorage.setItem("jms_auth_promo_visits", "999");
    } catch {
      /* private mode -- fine, banner just shows once and gets dismissed live */
    }
  });
  const authPage = await authContext.newPage();
  await authPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await authPage.waitForTimeout(1000);
  await dismissBanners(authPage);
  await authPage.fill('input[type="email"]', EMAIL);
  await authPage.fill('input[type="password"]', PASSWORD);
  try {
    await authPage.click('button[type="submit"]', { force: true });
    await authPage.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 45000 });
  } catch (err) {
    await authPage.screenshot({ path: path.join(OUTPUT_DIR, "login-debug.png") });
    console.error("Login navigation failed -- see output/login-debug.png. Current URL:", authPage.url());
    throw err;
  }

  if (authPage.url().includes("/select-branch")) {
    await authPage.waitForLoadState("networkidle");
    const firstBranch = authPage.locator("label").first();
    await firstBranch.click();
    await authPage.click('button[type="submit"]');
    await authPage.waitForURL((url) => url.pathname.includes("/sales"), { timeout: 30000 });
  }
  await authPage.waitForLoadState("networkidle");

  // Dismiss the Guided Onboarding Tour here, off-screen, if this demo
  // account hasn't seen it yet -- writes tour_completed_at for the
  // profile (see hooks/tour-context.tsx), so it never appears in the
  // actual recorded pass, on this run or any future one.
  await authPage.waitForTimeout(1000);
  const tourSkip = authPage.getByLabel(/skip/i);
  if (await tourSkip.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tourSkip.click();
    await authPage.waitForTimeout(500);
  }

  const landingUrl = authPage.url();
  const storageState = await authContext.storageState();
  await authContext.close();

  // --- The actual recorded pass -------------------------------------
  const recordContext = await browser.newContext({
    viewport: SCREEN,
    storageState,
    recordVideo: { dir: OUTPUT_DIR, size: SCREEN },
  });
  const page = await recordContext.newPage();
  recordingStartedAt = Date.now();
  clickLog = [];

  await page.goto(landingUrl, { waitUntil: "networkidle" });
  await runSteps(page);

  const video = page.video();
  await recordContext.close(); // flushes the .webm to disk
  const rawPath = video ? await video.path() : null;

  writeFileSync(path.join(OUTPUT_DIR, "clicks.json"), JSON.stringify(clickLog, null, 2));

  if (rawPath) {
    const finalPath = path.join(OUTPUT_DIR, "raw.webm");
    renameSync(rawPath, finalPath);
    console.log(`Recorded ${finalPath}`);
  }
  console.log(`Logged ${clickLog.length} taps -> ${path.join(OUTPUT_DIR, "clicks.json")}`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

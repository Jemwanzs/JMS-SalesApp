// Regenerates public/docs/User-Guide.pdf from the content in this file
// (kept aligned with docs/USER_GUIDE.md -- update both together) plus
// the screenshots in scripts/user-guide-assets/.
//
// Usage:
//   npm install --no-save playwright && npx playwright install chromium
//   node scripts/build-user-guide-pdf.mjs
//
// playwright is deliberately NOT a normal devDependency -- it pulls
// down a full Chromium binary, which nobody needs for ordinary
// development. Install it ad hoc only when actually regenerating this
// PDF.
//
// To refresh the screenshots themselves: sign in as a real (ideally
// disposable/demo) tenant with a populated catalog and some sample
// sales, and re-capture each screen in scripts/user-guide-assets/ at
// the app's own mobile viewport (430x900) -- filenames must match the
// `shot(...)`/`img(...)` calls below exactly.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(__dirname, "user-guide-assets");
const OUT_DIR = path.join(__dirname, "..", "public", "docs");
mkdirSync(OUT_DIR, { recursive: true });

function img(name) {
  const b64 = readFileSync(path.join(SHOTS, `${name}.png`)).toString("base64");
  return `data:image/png;base64,${b64}`;
}

const shot = (name, caption) => `
  <figure class="phone">
    <img src="${img(name)}" alt="${caption}" />
    <figcaption>${caption}</figcaption>
  </figure>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  /* No @page margin here -- Playwright's own page.pdf({margin}) option is
     the authoritative page margin for this document (a single uniform
     value for every page, small on purpose: see the cover page comment
     below for why). Content pages add their OWN padding on top of that
     small base margin instead of relying on a bigger @page margin. */
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Outfit", -apple-system, "Segoe UI", sans-serif;
    color: #1a1a1a;
    font-size: 10.3pt;
    line-height: 1.55;
    background: #ffffff;
  }
  h1, h2, h3 { font-family: "Outfit", sans-serif; font-weight: 700; margin: 0; }
  .section { break-before: page; padding: 16mm 12mm 14mm; }
  .section:first-of-type { break-before: avoid; }
  .kicker {
    display: inline-block;
    font-size: 8.5pt;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #10786A;
    background: #e8f3f0;
    padding: 3px 10px;
    border-radius: 999px;
    margin-bottom: 8px;
  }
  h2.section-title { font-size: 19pt; color: #0B1220; margin-bottom: 4px; }
  .section-lede { color: #55524a; font-size: 10.5pt; margin: 4px 0 14px; max-width: 92%; }
  h3.sub { font-size: 12pt; color: #0B1220; margin: 16px 0 6px; }
  p { margin: 0 0 8px; }
  ol.steps { margin: 6px 0 14px; padding-left: 0; list-style: none; counter-reset: step; }
  ol.steps li {
    counter-increment: step;
    position: relative;
    padding: 4px 0 4px 30px;
    margin-bottom: 6px;
  }
  ol.steps li::before {
    content: counter(step);
    position: absolute;
    left: 0; top: 3px;
    width: 20px; height: 20px;
    background: #10786A;
    color: #fff;
    font-size: 9pt;
    font-weight: 700;
    border-radius: 999px;
    display: flex; align-items: center; justify-content: center;
  }
  ul.bullets { margin: 6px 0 14px; padding-left: 18px; }
  ul.bullets li { margin-bottom: 5px; }
  strong { color: #0B1220; }
  .row { display: flex; gap: 14px; align-items: flex-start; margin: 10px 0 6px; }
  .row.wrap { flex-wrap: wrap; }
  .col-text { flex: 1 1 auto; min-width: 0; }
  figure.phone {
    margin: 0;
    flex: 0 0 auto;
    background: #f6efe0;
    border: 1px solid #e6d9bd;
    border-radius: 14px;
    padding: 8px 8px 6px;
    box-shadow: 0 6px 18px rgba(11,18,32,0.08);
  }
  figure.phone img {
    display: block;
    width: 100%;
    border-radius: 8px;
    border: 1px solid #eee;
  }
  figure.phone figcaption {
    font-size: 7.6pt;
    color: #7a7568;
    text-align: center;
    margin-top: 6px;
    font-weight: 500;
  }
  .shots-row { display: flex; gap: 10px; margin: 10px 0 16px; }
  .shots-row figure.phone { width: 31%; }
  .shots-pair { display: flex; gap: 12px; margin: 10px 0 4px; }
  .shots-pair figure.phone { width: 46%; }
  .single-shot { width: 46%; float: right; margin: 0 0 10px 14px; }
  table.feature-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 9.5pt; }
  table.feature-table th {
    text-align: left; background: #f6efe0; color: #0B1220;
    padding: 7px 9px; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.04em;
  }
  table.feature-table td { padding: 8px 9px; border-top: 1px solid #eee; vertical-align: top; }
  table.feature-table tr:nth-child(even) td { background: #fbf8f2; }

  /* Cover page -- fills the printable content area exactly (A4 297mm
     minus the 10mm top+bottom margin Playwright's page.pdf({margin})
     applies to every page). No negative-margin "bleed" trick: that
     fights Playwright's own margin box rather than working with it, and
     produces unpredictable overlap with the next page's content instead
     of a real edge-to-edge print. A modest uniform margin everywhere
     (including the cover) is the safe, standard way to do this. */
  .cover {
    break-before: avoid;
    height: 277mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    background: linear-gradient(160deg, #0B1220 0%, #132234 55%, #10786A 130%);
    color: #fff;
    padding: 14mm 14mm;
    border-radius: 6mm;
  }
  .cover .brand { display: flex; align-items: center; gap: 10px; }
  .cover .brand .mark {
    width: 34px; height: 34px; border-radius: 999px;
    background: #fff; display: flex; align-items: center; justify-content: center;
    font-weight: 800; color: #10786A; font-size: 16px;
  }
  .cover .brand .name { font-size: 15pt; font-weight: 800; letter-spacing: 0.02em; }
  .cover .brand .name span { color: #4fd6b8; }
  .cover .headline { margin-top: 40mm; }
  .cover .headline .eyebrow {
    font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.18em; color: #8fe6d0; margin-bottom: 10px;
  }
  .cover .headline h1 { font-size: 34pt; line-height: 1.12; max-width: 80%; }
  .cover .headline p.tag { margin-top: 12px; font-size: 12pt; color: #cfd8e2; max-width: 75%; }
  .cover .footer-block { border-top: 1px solid rgba(255,255,255,0.18); padding-top: 12px; }
  .cover .footer-block .built { font-size: 10pt; color: #cfe9e0; }
  .cover .footer-block .built b { color: #fff; }

  /* TOC */
  .toc-page { break-before: page; padding: 16mm 12mm 14mm; }
  .toc-page h2 { font-size: 20pt; color: #0B1220; margin-bottom: 4px; }
  .toc-page .section-lede { margin-bottom: 18px; }
  .toc-list { list-style: none; padding: 0; margin: 0; }
  .toc-list li {
    display: flex; align-items: baseline; gap: 8px;
    padding: 9px 0; border-bottom: 1px dashed #e6dfce;
  }
  .toc-list .letter {
    width: 22px; height: 22px; flex: 0 0 auto;
    background: #0B1220; color: #fff; border-radius: 6px;
    font-size: 9.5pt; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
  }
  .toc-list .label { font-weight: 600; color: #1a1a1a; font-size: 10.5pt; }

  .journey-strip {
    margin-top: 16px; padding: 12px 14px; background: #f6efe0; border-radius: 10px;
    font-size: 9.3pt; color: #4a4738; line-height: 1.6;
  }
  .journey-strip b { color: #10786A; }
</style>
</head>
<body>

<div class="cover">
  <div class="brand">
    <div class="mark">$</div>
    <div class="name">JM<span>S</span> Sales App</div>
  </div>
  <div class="headline">
    <div class="eyebrow">User Guide</div>
    <h1>Everything your business needs to run daily sales, on one phone.</h1>
    <p class="tag">A short, practical, step-by-step guide — from signing up to monitoring performance — for every JMS Sales App user.</p>
  </div>
  <div class="footer-block">
    <div class="built">Built by <b>James</b> — <b>SyncScore Ltd</b> · Technology Firm</div>
  </div>
</div>

<div class="toc-page">
  <span class="kicker">Contents</span>
  <h2>What's inside</h2>
  <p class="section-lede">Short sections, each straight to the point — read start to finish, or jump to what you need.</p>
  <ul class="toc-list">
    <li><span class="letter">A</span><span class="label">Introduction — what the app does, and its strengths</span></li>
    <li><span class="letter">B</span><span class="label">Getting Started — Sign Up, Business Setup, Login, Dashboard</span></li>
    <li><span class="letter">C</span><span class="label">Setting Up the Business</span></li>
    <li><span class="letter">D</span><span class="label">Inviting Employees / Users</span></li>
    <li><span class="letter">E</span><span class="label">Recording Sales</span></li>
    <li><span class="letter">F</span><span class="label">Products</span></li>
    <li><span class="letter">G</span><span class="label">Users &amp; Permissions</span></li>
    <li><span class="letter">H</span><span class="label">Reports &amp; Analytics</span></li>
    <li><span class="letter">I</span><span class="label">Billing &amp; Subscription</span></li>
    <li><span class="letter">J</span><span class="label">Other Features</span></li>
  </ul>
  <div class="journey-strip">
    <b>Your complete journey:</b> Sign up → Complete business setup → Add products → Invite employees →
    Employees record daily sales → Monitor sales → Access reports &amp; analytics → Manage the account confidently.
  </div>
</div>

<div class="section">
  <span class="kicker">A · Introduction</span>
  <h2 class="section-title">What JMS Sales App does</h2>
  <p class="section-lede">A mobile-first sales capture and business-performance platform for small and growing businesses.</p>

  <p>JMS Sales App gives every business — a shop, a kiosk, a restaurant, a service counter — one simple daily
  workflow: <strong>record every sale as it happens, keep a clean history of it, and see how the business is really
  performing.</strong></p>

  <h3 class="sub">Who it's for</h3>
  <p>Any business owner or manager who wants their team logging sales on a phone, in seconds — no spreadsheets,
  no paper — and who wants trustworthy reports at the end of the day, week, or month.</p>

  <h3 class="sub">Key strengths</h3>
  <ul class="bullets">
    <li><strong>Built for phones.</strong> Every screen is designed mobile-first, fast to tap through at the counter.</li>
    <li><strong>One business, many people, one accurate picture.</strong> Invite your team, control exactly what each
      person can see and do, and every sale rolls up into one shared, trustworthy view of the business.</li>
    <li><strong>Nothing recorded twice.</strong> Sales are protected against accidental double-submission, and every
      correction, void, or reversal stays visible — never silently edited away.</li>
    <li><strong>Real reporting, not guesswork.</strong> Daily summaries, product performance, and staff performance
      are generated automatically from what was actually sold.</li>
    <li><strong>Private per business.</strong> Every business's data is fully isolated from every other business.</li>
  </ul>

  <p>From the moment a sale is made to the moment the owner checks performance, JMS Sales App connects the two:
  <strong>capture → history → reports → decisions.</strong></p>
</div>

<div class="section">
  <span class="kicker">B · Getting Started</span>
  <h2 class="section-title">Sign Up → Business Setup → Login → Dashboard</h2>
  <p class="section-lede">The whole path from nothing to a working account takes a few minutes.</p>

  <h3 class="sub">Step 1 — Sign Up</h3>
  <ol class="steps">
    <li>Open the app and tap <strong>Sign up</strong>.</li>
    <li>Enter your first name, last name, business name, email, phone, country, and a password.</li>
    <li>Tap <strong>Create account</strong>.</li>
  </ol>

  <h3 class="sub">Step 2 — Business Setup (Onboarding)</h3>
  <p>The first time you log in, a short wizard walks you through <strong>business details</strong> (type, website,
  currency, timezone) and <strong>location &amp; hours</strong> (your primary location and opening hours for each
  day). This happens once — every login after that goes straight to your dashboard.</p>

  <h3 class="sub">Steps 3 &amp; 4 — Login and Dashboard</h3>
  <p>Return any time at the Login page. You land on <strong>Capture Sales</strong>, with a bottom navigation bar
  giving access to Sales, History, Analytics, Reports, and More (everything else).</p>

  <div class="shots-row">
    ${shot("01-login", "Login")}
    ${shot("02-signup", "Sign up")}
    ${shot("03-onboarding", "Business setup — Step 1")}
  </div>
</div>

<div class="section">
  <span class="kicker">C · Setting Up the Business</span>
  <h2 class="section-title">Before your team starts selling</h2>
  <p class="section-lede">A few minutes of setup makes everything else run smoothly.</p>

  <ul class="bullets">
    <li><strong>Business profile</strong> — go to <strong>More → Settings</strong> any time to review business
      details, currency, and configuration — not just during onboarding.</li>
    <li><strong>Business settings</strong> — also under Settings: toggle <strong>product ranking</strong>
      (Gold/Silver/Bronze badges), <strong>daily sales volume</strong> visibility, <strong>product price</strong>
      visibility on the Sales screen, the <strong>sale number format</strong>, and automatic
      <strong>business-anniversary wishes</strong> for your team.</li>
    <li><strong>Products</strong> — go to <strong>More → Products</strong> to build your catalog (see section F).</li>
    <li><strong>Sales-related security</strong> — under <strong>More → Security</strong>, optionally restrict login
      to business hours and/or your business's physical location.</li>
  </ul>
</div>

<div class="section">
  <span class="kicker">D · Inviting Employees</span>
  <h2 class="section-title">Bring your team onto the platform</h2>
  <p class="section-lede">A Tenant Administrator can invite anyone who needs to capture sales or manage the business.</p>

  <ol class="steps">
    <li>Go to <strong>More → Users</strong>.</li>
    <li>Tap <strong>Invite user</strong>.</li>
    <li>Enter their <strong>full name</strong>, <strong>email</strong>, and choose a <strong>role</strong>.</li>
    <li>Tap <strong>Invite</strong> — they receive an email invitation.</li>
    <li>Once they accept and set a password, they're added — active immediately, no further action needed.</li>
  </ol>

  <h3 class="sub">What invited users can access</h3>
  <p>Access is controlled entirely by role: <strong>Sales User</strong> (record sales, see their own history/
  analytics), <strong>Supervisor</strong> (broader visibility across the business), or
  <strong>Tenant Administrator</strong> (full access to everything). Roles can be reviewed and customized under
  <strong>More → Roles</strong>.</p>

  <p>On the Users page, an invited person shows as <strong>Invited</strong> until they accept, then
  <strong>Active</strong>. Once active, <strong>that employee can log in on their own device and immediately start
  recording their own daily sales</strong> — this is the whole point of inviting them.</p>

  <div class="shots-pair">
    ${shot("11a-users-list", "Users list")}
    ${shot("11b-invite-user-dialog", "Invite a user")}
  </div>
</div>

<div class="section">
  <span class="kicker">E · Recording Sales</span>
  <h2 class="section-title">The screen your team uses the most</h2>
  <p class="section-lede">Fast enough to use with a customer standing at the counter.</p>

  <img class="single-shot" src="${img("04-capture-sales")}" alt="Capture Sales" />

  <ol class="steps">
    <li>Tap <strong>Sales</strong> in the bottom navigation — your product catalog appears as a scrollable list.</li>
    <li><strong>Search</strong> for a product by name using the search bar if the list is long.</li>
    <li>Tap a product to open <strong>Record Sale</strong>.</li>
    <li>Product not in your catalog? Tap <strong>Others</strong> at the bottom of the list — a required
      <strong>"Enter Product Name"</strong> field appears. The sale still records correctly under that typed name.</li>
    <li>Enter the <strong>amount sold</strong> (and quantity, if enabled for your business).</li>
    <li>Tap <strong>Record Sale</strong> — you'll see an instant confirmation.</li>
    <li>Tap <strong>History</strong> any time to review what's already been recorded.</li>
  </ol>

  <p>Every sale is protected from accidental duplicate submissions — a double-tap or a network retry never creates
  two records.</p>

  <div class="shots-pair">
    ${shot("05-record-sale-dialog", "Record Sale")}
    ${shot("06-sales-history", "Sales History (defaults to today)")}
  </div>
</div>

<div class="section">
  <span class="kicker">F · Products</span>
  <h2 class="section-title">Managing your catalog</h2>
  <p class="section-lede">Go to <strong>More → Products</strong>.</p>

  <img class="single-shot" src="${img("10-products")}" alt="Products" />

  <ul class="bullets">
    <li><strong>Creating a product</strong> — enter a name, price, and optional description, then save.</li>
    <li><strong>Editing</strong> — tap a product's edit icon to change name, price, or description.</li>
    <li><strong>Product images</strong> — open a product to upload, replace, or remove its photo.</li>
    <li><strong>Activating / deactivating</strong> — hide a product from the Sales screen without deleting it or
      losing its history.</li>
    <li><strong>Deleting</strong> — only possible if the product has never been sold; otherwise, deactivate it.</li>
    <li><strong>Searching</strong> — use the search bar at the top to instantly filter a long catalog.</li>
    <li><strong>Bulk upload</strong> — download the products template, fill in Product Name, Expected Price, and
      Image URL, then upload it in one go.</li>
    <li><strong>On the Sales screen</strong> — active products appear in this same order, with an automatic
      <strong>Others</strong> entry always last.</li>
  </ul>
</div>

<div class="section">
  <span class="kicker">G · Users &amp; Permissions</span>
  <h2 class="section-title">Who can do what</h2>
  <p class="section-lede">Go to <strong>More → Users</strong> to manage your team, and <strong>More → Roles</strong> to manage what each role can do.</p>

  <ul class="bullets">
    <li><strong>Viewing users</strong> — see everyone's name, email, status, and role in one list.</li>
    <li><strong>Inviting new users</strong> — see section D.</li>
    <li><strong>User roles</strong> — assign or change a user's role directly from the Users list.</li>
    <li><strong>Activating / deactivating</strong> — disable access instantly (e.g. when someone leaves) without
      deleting their sales history, or re-enable later.</li>
    <li><strong>Editing a name</strong> — a Tenant Administrator can correct a teammate's display name after they've
      accepted their invite.</li>
    <li><strong>Access control &amp; data separation</strong> — every business on JMS Sales App is fully isolated;
      your team only ever sees your business's data, regardless of plan or role.</li>
  </ul>
</div>

<div class="section">
  <span class="kicker">H · Reports &amp; Analytics</span>
  <h2 class="section-title">Understand how the business is doing</h2>
  <p class="section-lede">Two complementary views: real-time Analytics, and automatically generated Reports.</p>

  <h3 class="sub">Analytics</h3>
  <p>Bottom navigation → <strong>Analytics</strong>: total sales, transaction count, average/highest/lowest sale,
  and <strong>Top Products</strong> ranked by revenue. Gold/Silver/Bronze badges on the Sales screen highlight your
  best sellers over the trailing 30 days. Filter by today, a custom range, or (with permission) any past date.</p>

  <h3 class="sub">Reports</h3>
  <p>Bottom navigation → <strong>Reports</strong>: an automatic <strong>daily summary</strong> — gross sales,
  transaction count, average sale, top product, and top sales person — generated for each business day, with a
  comparison to the previous day.</p>

  <h3 class="sub">Daily Sales PDF &amp; staff performance</h3>
  <p>From <strong>History</strong>, tap <strong>Daily Report</strong> to generate a shareable, downloadable PDF of
  the day's sales. Because every report and analytics view reflects who actually recorded each sale, staff
  performance is visible to anyone with the right permission.</p>

  <div class="shots-pair">
    ${shot("07-analytics", "Analytics")}
    ${shot("08-reports", "Reports")}
  </div>
</div>

<div class="section">
  <span class="kicker">I · Billing &amp; Subscription</span>
  <h2 class="section-title">Keeping the account active</h2>
  <p class="section-lede">Go to <strong>More → Billing</strong>.</p>

  <img class="single-shot" src="${img("13-billing")}" alt="Billing" />

  <ul class="bullets">
    <li><strong>Trial status</strong> — every new business starts on a free trial; Billing shows days remaining.</li>
    <li><strong>Subscription plans</strong> — pick a plan and duration that fits your business, with pricing shown
      clearly before you confirm.</li>
    <li><strong>Making a payment</strong> — processed securely through Paystack; you're returned automatically once
      complete.</li>
    <li><strong>Billing history</strong> — every past payment listed with date, amount, and status.</li>
    <li><strong>If a subscription expires</strong> — a short grace period follows, after which access is restricted
      until a plan is renewed. Status and renewal are always visible right here.</li>
  </ul>
</div>

<div class="section">
  <span class="kicker">J · Other Features</span>
  <h2 class="section-title">Everything else, at a glance</h2>
  <p class="section-lede">Reviewed against the live app — nothing here is planned or upcoming functionality.</p>

  <div class="shots-pair">
    ${shot("09-more-menu", "More — everything in one menu")}
    ${shot("12-security", "Security")}
  </div>

  <table class="feature-table">
    <thead><tr><th>Where to go</th><th>What it does</th><th>What to do</th></tr></thead>
    <tbody>
      <tr><td><strong>More → Security</strong></td><td>Manage login restrictions (business hours, location) and see recent login activity/active sessions.</td><td>Turn restrictions on for work-only sign-in; force sign-out a lost device.</td></tr>
      <tr><td><strong>More → Approvals</strong></td><td>Review requests needing sign-off — e.g. a sale correction or a temporary access request.</td><td>Approve or reject pending requests.</td></tr>
      <tr><td><strong>More → Imports</strong></td><td>Bring in historical sales or a product catalog in bulk from a spreadsheet.</td><td>Download the template, fill it in, upload, review flagged rows, confirm.</td></tr>
      <tr><td><strong>Sales History → row actions</strong></td><td>Void, correct, or reverse a sale (permission-dependent), with a required reason.</td><td>Use this instead of trying to "undo" a sale — every change stays visible.</td></tr>
      <tr><td><strong>Notifications banner</strong></td><td>A short banner (e.g. a business-anniversary wish) appears at the top when relevant.</td><td>No action needed — it clears itself automatically.</td></tr>
    </tbody>
  </table>

  <div class="journey-strip" style="margin-top:20px">
    <b>That's the whole app.</b> Sign up → Complete business setup → Add products → Invite employees → Employees
    record daily sales from their own accounts → Monitor sales → Access reports &amp; analytics → Manage billing
    and settings with confidence. Welcome aboard.
  </div>
</div>

</body>
</html>`;

const htmlPath = path.join(OUT_DIR, "..", "..", "scripts", "user-guide-preview.html");
writeFileSync(htmlPath, html);
console.log("HTML written:", htmlPath, `(${(html.length / 1024 / 1024).toFixed(2)} MB)`);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);

const outPdf = path.join(OUT_DIR, "User-Guide.pdf");
await page.pdf({
  path: outPdf,
  format: "A4",
  printBackground: true,
  // A single small, uniform margin -- Playwright applies one margin
  // config to the whole document (no per-page override), so this is
  // also what the cover page fills right up to (see its own CSS
  // comment for why that's the safe way to get a near-edge-to-edge
  // cover instead of fighting this margin with negative CSS margins).
  margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
  displayHeaderFooter: true,
  headerTemplate: `<div></div>`,
  footerTemplate: `
    <div style="font-family: 'Outfit', sans-serif; font-size: 7.5pt; color: #8a8574; width: 100%; padding: 0 10mm; display: flex; justify-content: space-between; align-items: center;">
      <span>Built by <b>James</b> &mdash; SyncScore Ltd | Technology Firm</span>
      <span class="pageNumber"></span>
    </div>`,
});

console.log("PDF written:", outPdf);
await browser.close();

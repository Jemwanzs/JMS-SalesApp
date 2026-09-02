// One-off (rerun only after editing frame-template.html): renders the
// SVG bezel to a transparent PNG via a real browser, so the rounded-rect
// mask/shadow math is whatever Chromium actually paints rather than
// something computed by hand. See frame-template.html's header comment
// for the exact geometry this produces.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(__dirname, "frame-template.html");
const outputPath = path.join(__dirname, "assets", "phone-frame.png");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 600, height: 1100 } });
await page.goto(`file://${templatePath}`);
await page.screenshot({ path: outputPath, omitBackground: true });
await browser.close();

console.log(`Wrote ${outputPath}`);

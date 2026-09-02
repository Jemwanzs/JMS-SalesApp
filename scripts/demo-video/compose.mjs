// Takes record.mjs's raw.webm + clicks.json and produces the final,
// shareable MP4: composited into the phone-frame bezel, with a short
// synthesized tap sound placed at each recorded click's timestamp.
// Run: node scripts/demo-video/compose.mjs
// See docs/25-demo-video-generation.md for the full pipeline.
import ffmpegPath from "ffmpeg-static";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_DIR = path.join(__dirname, "output");
const ASSETS_DIR = path.join(__dirname, "assets");

const RAW_VIDEO = path.join(OUTPUT_DIR, "raw.webm");
const CLICKS_JSON = path.join(OUTPUT_DIR, "clicks.json");
const FRAME_PNG = path.join(ASSETS_DIR, "phone-frame.png");
const TAP_WAV = path.join(OUTPUT_DIR, "tap.wav");
const FINAL_MP4 = path.join(ROOT, "public", "demo-video-v1.mp4");

// Must match frame-template.html's geometry (see that file's header
// comment): the screen cutout sits at (105,105), sized 390x844, inside
// a 600x1100 canvas.
const CANVAS = { width: 600, height: 1100 };
const SCREEN = { x: 105, y: 105, width: 390, height: 844 };
const BG_COLOR = "0x1c1c1e";

for (const [label, p] of [
  ["raw.webm", RAW_VIDEO],
  ["clicks.json", CLICKS_JSON],
  ["phone-frame.png", FRAME_PNG],
]) {
  if (!existsSync(p)) {
    throw new Error(`Missing ${label} at ${p}. Run record.mjs (and generate-frame.mjs, once) first.`);
  }
}

function ffmpeg(args) {
  execFileSync(ffmpegPath, args, { stdio: "inherit" });
}

/**
 * ffmpeg's own `-shortest`/overlay `shortest=1` proved unreliable for
 * this graph (a lavfi color source with a long fixed `d=` outlived the
 * finite raw recording, and the composite ran for "hours" instead of
 * stopping at the real ~100s mark). Probing the real duration up front
 * and hard-trimming the final output with `-t` is simple and exact --
 * no reliance on filter-graph EOF propagation at all.
 */
function probeDurationSeconds(videoPath) {
  const result = spawnSync(ffmpegPath, ["-i", videoPath], { encoding: "utf8" });
  const stderr = result.stderr || "";
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) {
    throw new Error(`Could not parse duration from ffmpeg output for ${videoPath}`);
  }
  const [, h, m, s] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

// --- 1. Synthesize a short, neutral tap sound (no external audio asset
// -- avoids any licensing question). A quick descending tone with a
// fast fade, ~110ms. ---
ffmpeg([
  "-y",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=1400:duration=0.11",
  "-af",
  "afade=t=out:st=0.04:d=0.07,volume=0.5",
  TAP_WAV,
]);

// --- 2. Composite: background colour -> raw recording -> phone bezel,
// plus a tap-sound mix placed at each click's real timestamp. ---
const clicks = JSON.parse(readFileSync(CLICKS_JSON, "utf8"));
const durationSeconds = probeDurationSeconds(RAW_VIDEO);
console.log(`raw.webm duration: ${durationSeconds.toFixed(2)}s`);

const inputs = [
  "-i",
  RAW_VIDEO,
  "-loop",
  "1",
  "-i",
  FRAME_PNG,
  "-f",
  "lavfi",
  "-i",
  `color=c=${BG_COLOR}:s=${CANVAS.width}x${CANVAS.height}:d=600`,
  "-f",
  "lavfi",
  "-i",
  "anullsrc=r=44100:cl=stereo",
];
for (let i = 0; i < clicks.length; i += 1) {
  inputs.push("-i", TAP_WAV);
}

const filterParts = [
  `[2:v][0:v]overlay=${SCREEN.x}:${SCREEN.y}[bg1]`,
  `[bg1][1:v]overlay=0:0[vout]`,
];
const audioLabels = ["[3:a]"];
clicks.forEach((click, i) => {
  const inputIndex = 4 + i; // 0=video,1=frame,2=color,3=anullsrc,4..=tap.wav copies
  const delayMs = Math.max(0, Math.round(click.tMs));
  const label = `[d${i}]`;
  filterParts.push(`[${inputIndex}:a]adelay=${delayMs}|${delayMs}${label}`);
  audioLabels.push(label);
});
filterParts.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=0,volume=${audioLabels.length}[aout]`);

ffmpeg([
  "-y",
  ...inputs,
  "-filter_complex",
  filterParts.join(";"),
  "-map",
  "[vout]",
  "-map",
  "[aout]",
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  "-c:a",
  "aac",
  "-b:a",
  "128k",
  "-t",
  String(durationSeconds),
  FINAL_MP4,
]);

console.log(`Wrote ${FINAL_MP4}`);

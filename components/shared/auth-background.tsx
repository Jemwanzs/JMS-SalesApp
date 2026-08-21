import fs from "node:fs";
import path from "node:path";
import Image from "next/image";

const CANDIDATE_FILES = [
  "photo-1.jpg",
  "photo-2.jpg",
  "photo-3.jpg",
  "photo-4.jpg",
  "photo-5.jpg",
  "photo-6.jpg",
  "photo-1.png",
  "photo-2.png",
  "photo-3.png",
  "photo-4.png",
  "photo-5.png",
  "photo-6.png",
];

// Hand-authored scatter -- NOT Math.random() at render time, which
// would render differently on the server vs. the client and break
// hydration. Percent-based positions so the layout scales with the
// viewport; each tile cycles through whichever photos actually exist
// (see the fs check below), repeating them at different positions/
// sizes/rotations so even one or two source photos fill the page like
// a real photo wall.
const TILES = [
  { top: "-4%", left: "4%", size: 150, rotate: -12 },
  { top: "1%", left: "60%", size: 130, rotate: 9 },
  { top: "15%", left: "-6%", size: 170, rotate: 6 },
  { top: "18%", left: "80%", size: 120, rotate: -8 },
  { top: "34%", left: "30%", size: 140, rotate: 14 },
  { top: "32%", left: "-5%", size: 110, rotate: -6 },
  { top: "48%", left: "68%", size: 160, rotate: -14 },
  { top: "60%", left: "5%", size: 130, rotate: 10 },
  { top: "68%", left: "38%", size: 120, rotate: -9 },
  { top: "76%", left: "78%", size: 150, rotate: 7 },
  { top: "88%", left: "14%", size: 140, rotate: -11 },
  { top: "90%", left: "56%", size: 130, rotate: 13 },
] as const;

/**
 * Decorative, blurred photo-wall background for the auth screens
 * (login/signup/reset-password/verify-email/invite-confirm all share
 * app/(auth)/layout.tsx). Reads whichever files actually exist under
 * public/login-bg/ at request time -- a plain Node fs check, safe here
 * since this only ever renders server-side -- so a missing photo never
 * shows a broken image; falls back to a soft cream gradient when none
 * have been added yet, so the page still looks finished either way.
 *
 * Drop real photos in as public/login-bg/photo-1.jpg, photo-2.jpg, etc.
 * (jpg or png, any name from that fixed list) and they take over
 * automatically -- no code change needed.
 */
export function AuthBackground() {
  const publicDir = path.join(process.cwd(), "public", "login-bg");
  const available = CANDIDATE_FILES.filter((f) => fs.existsSync(path.join(publicDir, f)));

  if (available.length === 0) {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-[#f5ead2] via-[#faf3e6] to-[#efe0c2] dark:from-[#241d15] dark:via-[#1b1611] dark:to-[#100d09]"
      />
    );
  }

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {TILES.map((tile, i) => {
        const file = available[i % available.length];
        return (
          <div
            key={i}
            className="absolute overflow-hidden rounded-2xl opacity-40 blur-[2px] saturate-75"
            style={{
              top: tile.top,
              left: tile.left,
              width: tile.size,
              height: tile.size,
              transform: `rotate(${tile.rotate}deg)`,
            }}
          >
            <Image src={`/login-bg/${file}`} alt="" fill sizes="200px" className="object-cover" />
          </div>
        );
      })}
      <div className="absolute inset-0 bg-background/55" />
    </div>
  );
}

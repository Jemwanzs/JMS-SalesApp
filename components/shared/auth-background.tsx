import fs from "node:fs";
import path from "node:path";
import Image from "next/image";

const CANDIDATE_FILES = Array.from({ length: 6 }, (_, i) => i + 1).flatMap((n) => [
  `photo-${n}.jpg`,
  `photo-${n}.jpeg`,
  `photo-${n}.png`,
]);

// Hand-authored scatter -- NOT Math.random() at render time, which
// would render differently on the server vs. the client and break
// hydration. Percent-based positions so the layout scales within the
// mobile-width column (see the auth layout's own max-w-[430px] shell,
// which this is confined to -- not the full browser viewport on a
// wider screen). Deliberately capped at 4 tiles, framing the card's
// corners rather than covering the whole page -- each cycles through
// whichever photos actually exist (see the fs check below).
const TILES = [
  { top: "2%", left: "3%", size: 150, rotate: -10 },
  { top: "1%", left: "58%", size: 130, rotate: 9 },
  { top: "80%", left: "4%", size: 140, rotate: -9 },
  { top: "82%", left: "56%", size: 140, rotate: 12 },
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
 * Drop real photos in as public/login-bg/photo-1.jpg, photo-2.jpeg, etc.
 * (jpg/jpeg/png, any name from that fixed list) and they take over
 * automatically -- no code change needed.
 */
export function AuthBackground() {
  const publicDir = path.join(process.cwd(), "public", "login-bg");
  const available = CANDIDATE_FILES.filter((f) => fs.existsSync(path.join(publicDir, f)));

  if (available.length === 0) {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#f5ead2] via-[#faf3e6] to-[#efe0c2] dark:from-[#241d15] dark:via-[#1b1611] dark:to-[#100d09]"
      />
    );
  }

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {TILES.map((tile, i) => {
        const file = available[i % available.length];
        return (
          <div
            key={i}
            className="absolute overflow-hidden rounded-2xl opacity-80 blur-[1.5px] saturate-90"
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
      <div className="absolute inset-0 bg-background/25" />
    </div>
  );
}

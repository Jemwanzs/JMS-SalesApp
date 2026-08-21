import fs from "node:fs";
import path from "node:path";
import Image from "next/image";

const EXTENSIONS = ["jpg", "jpeg", "png"];

// One specific photo per corner (not a cyclic fill) -- explicit
// assignment: photo-1 top-left, photo-3 top-right, photo-4 bottom-left,
// photo-2 bottom-right. Percent-based positions so this scales within
// the mobile-width column (see the auth layout's own max-w-[430px]
// shell, which this is confined to -- not the full browser viewport on
// a wider screen). All four tiles share TILE_SIZE so every frame is the
// same size -- only rotation varies, for a natural (not perfectly
// grid-aligned) collage look.
const TILE_SIZE = 140;
const CORNER_TILES = [
  { photo: "photo-1", top: "2%", left: "3%", rotate: -10 },
  { photo: "photo-3", top: "1%", left: "58%", rotate: 9 },
  { photo: "photo-4", top: "80%", left: "4%", rotate: -9 },
  { photo: "photo-2", top: "82%", left: "56%", rotate: 12 },
] as const;

/** Resolves "photo-1" to whichever extension actually exists under
 * public/login-bg/ (jpg/jpeg/png), or null if that photo is missing --
 * a missing corner is just skipped, never a broken image. */
function resolvePhoto(publicDir: string, base: string): string | null {
  for (const ext of EXTENSIONS) {
    if (fs.existsSync(path.join(publicDir, `${base}.${ext}`))) {
      return `${base}.${ext}`;
    }
  }
  return null;
}

/**
 * Decorative, blurred photo-wall background for the auth screens
 * (login/signup/reset-password/verify-email/invite-confirm all share
 * app/(auth)/layout.tsx). Reads whichever of the four named photos
 * actually exist under public/login-bg/ at request time -- a plain
 * Node fs check, safe here since this only ever renders server-side --
 * so a missing photo never shows a broken image; falls back to a soft
 * cream gradient when none of the four exist yet, so the page still
 * looks finished either way.
 *
 * Drop real photos in as public/login-bg/photo-1.jpg (or .jpeg/.png),
 * photo-2.*, photo-3.*, photo-4.* and they take over automatically --
 * no code change needed, corner assignment stays as specified above.
 */
export function AuthBackground() {
  const publicDir = path.join(process.cwd(), "public", "login-bg");
  const tiles = CORNER_TILES.map((tile) => ({ ...tile, file: resolvePhoto(publicDir, tile.photo) })).filter(
    (t): t is (typeof CORNER_TILES)[number] & { file: string } => t.file !== null
  );

  if (tiles.length === 0) {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#f5ead2] via-[#faf3e6] to-[#efe0c2] dark:from-[#241d15] dark:via-[#1b1611] dark:to-[#100d09]"
      />
    );
  }

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {tiles.map((tile) => (
        <div
          key={tile.photo}
          className="absolute overflow-hidden rounded-2xl opacity-80 blur-[1.5px] saturate-90"
          style={{
            top: tile.top,
            left: tile.left,
            width: TILE_SIZE,
            height: TILE_SIZE,
            transform: `rotate(${tile.rotate}deg)`,
          }}
        >
          <Image src={`/login-bg/${tile.file}`} alt="" fill sizes="200px" className="object-cover" />
        </div>
      ))}
      <div className="absolute inset-0 bg-background/25" />
    </div>
  );
}

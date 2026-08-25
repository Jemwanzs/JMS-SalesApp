import fs from "node:fs";
import path from "node:path";

import { AuthBackgroundVariant, type ScatteredTile } from "@/components/shared/auth-background-variant";

const EXTENSIONS = ["jpg", "jpeg", "png"];

// One specific photo per corner (not a cyclic fill) -- explicit
// assignment: photo-1 top-left, photo-3 top-right, photo-4 bottom-left,
// photo-2 bottom-right. Percent-based positions so this scales within
// the mobile-width column (see the auth layout's own max-w-[430px]
// shell, which this is confined to -- not the full browser viewport on
// a wider screen). All four tiles share TILE_SIZE (in the client
// variant) so every frame is the same size -- only rotation varies,
// for a natural (not perfectly grid-aligned) collage look. Used for
// every auth route except /login, which gets a single full-bleed
// blurred photo instead (see AuthBackgroundVariant).
const CORNER_TILES = [
  { photo: "photo-1", top: "2%", left: "3%", rotate: -10 },
  { photo: "photo-3", top: "1%", left: "58%", rotate: 9 },
  { photo: "photo-4", top: "80%", left: "4%", rotate: -9 },
  { photo: "photo-2", top: "82%", left: "56%", rotate: 12 },
] as const;

const SINGLE_PHOTO = "photo-5";

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
 * Decorative background for the auth screens (login/signup/reset-
 * password/verify-email/invite-confirm all share app/(auth)/layout.tsx).
 * Reads whichever photos actually exist under public/login-bg/ at
 * request time -- a plain Node fs check, safe here since this only
 * ever renders server-side -- so a missing photo never shows a broken
 * image; falls back to a plain fill in the same very-light warm cream
 * as the auth layout's own page background when none exist yet.
 *
 * The actual per-route choice (single blurred photo-5 on /login,
 * scattered four-corner wall everywhere else) happens client-side in
 * AuthBackgroundVariant, since a shared Server Component layout has no
 * clean way to know which specific route it's currently rendering --
 * this component's only job is resolving file names, which must stay
 * server-side (fs access).
 */
export function AuthBackground() {
  const publicDir = path.join(process.cwd(), "public", "login-bg");
  const scatteredTiles: ScatteredTile[] = CORNER_TILES.map((tile) => ({ ...tile, file: resolvePhoto(publicDir, tile.photo) })).filter(
    (t): t is (typeof CORNER_TILES)[number] & { file: string } => t.file !== null
  );
  const singlePhotoFile = resolvePhoto(publicDir, SINGLE_PHOTO);

  return <AuthBackgroundVariant scatteredTiles={scatteredTiles} singlePhotoFile={singlePhotoFile} />;
}

"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";

const TILE_SIZE = 140;

export interface ScatteredTile {
  photo: string;
  file: string;
  top: string;
  left: string;
  rotate: number;
}

/**
 * Client-side pathname check -- the ONLY reason this piece is a client
 * component at all, since AuthBackground itself (its caller) needs to
 * stay server-side for the fs.existsSync photo resolution. `/login`
 * gets the single full-bleed blurred photo (explicit request: no more
 * four-photo collage there); every other auth route (signup, reset-
 * password, verify-email, invite-confirm) keeps the original scattered
 * four-corner wall unchanged.
 */
export function AuthBackgroundVariant({
  scatteredTiles,
  singlePhotoFile,
}: {
  scatteredTiles: ScatteredTile[];
  singlePhotoFile: string | null;
}) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";

  if (isLogin) {
    if (!singlePhotoFile) {
      return <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#fdfbf6] dark:bg-[#2d271d]" />;
    }

    return (
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* scale-110 pushes the blur's softened edge outside the visible
            frame -- without it, a hard-blurred image edge reads as a
            faint ring right at the container boundary. blur-sm (not
            blur-md) per explicit feedback -- the photo should still read
            as recognizable, not dissolve into an abstract wash. */}
        <Image
          src={`/login-bg/${singlePhotoFile}`}
          alt=""
          fill
          sizes="430px"
          className="scale-110 object-cover blur-sm saturate-90"
          priority
        />
        <div className="absolute inset-0 bg-[#fdfbf6]/20 dark:bg-[#2d271d]/30" />
      </div>
    );
  }

  if (scatteredTiles.length === 0) {
    return <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#fdfbf6] dark:bg-[#2d271d]" />;
  }

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {scatteredTiles.map((tile) => (
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
      <div className="absolute inset-0 bg-[#fdfbf6]/25 dark:bg-[#2d271d]/25" />
    </div>
  );
}

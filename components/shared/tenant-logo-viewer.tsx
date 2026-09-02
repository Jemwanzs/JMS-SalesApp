"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * The small header logo (app/(tenant)/t/[tenantSlug]/layout.tsx) --
 * rounded framing plus tap-to-view-full-size, only ever rendered when a
 * tenant has actually uploaded a logo (that condition stays in the
 * layout, unchanged; this component just presents whatever URL it's
 * given). Plain <img>, not next/image, for the same reason the layout's
 * own header comment already gives: uploads accept SVG, and next/image's
 * optimizer refuses SVGs without extra dangerouslyAllowSVG config.
 *
 * Deliberately NOT the shared components/ui/dialog.tsx here: that
 * primitive centers via CSS percentages against #app-shell's own
 * (possibly much taller than the viewport) box, since #app-shell sets
 * `contain: layout` so dialogs stay confined to the mobile column on a
 * wide desktop screen (see that layout's own comment). On a long,
 * scrollable page (e.g. Sales with many products) that means "centered"
 * is relative to the FULL scroll height, not what's currently visible --
 * verified live, it can land the dialog hundreds of pixels below the
 * fold when opened at scroll position 0, the most common case. That's a
 * real, pre-existing quirk affecting every dialog on a tall page, too
 * broad to fix here -- this viewer instead portals straight to
 * document.body with true `position: fixed`, which stays viewport-
 * relative regardless of scroll or page height.
 */
export function TenantLogoViewer({ logoUrl }: { logoUrl: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="View business logo"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-lg"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt="" className="h-8 max-w-[120px] rounded-lg object-contain" />
      </button>

      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Business logo"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
            onClick={() => setOpen(false)}
          >
            <div
              className="relative flex max-h-[85vh] w-full max-w-sm items-center justify-center overflow-hidden rounded-xl bg-popover p-6 ring-1 ring-foreground/10"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt="" className="max-h-[70vh] max-w-full object-contain" />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

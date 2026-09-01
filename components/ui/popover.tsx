"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn, getAppShellContainer } from "@/lib/utils"

// Same "no useTranslations() in a shared components/ui/* primitive"
// rule dialog.tsx's own header comment explains -- this file has no
// way to know whether its caller renders inside a NextIntlClientProvider.

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

// anchor accepts a raw Element (not just a Trigger-owned ref), which is
// the whole point of using Popover here instead of Dialog -- a Guided
// Onboarding Tour step points at an element rendered by an unrelated
// component (a nav tab, a button on another feature's page), not a
// trigger this popover owns. Portal+Positioner+Popup bundled into one
// component the same way DialogContent bundles Portal+Overlay+Popup,
// container always confined to the mobile app-shell column (see
// dialog.tsx's own comment on why).
function PopoverContent({
  className,
  children,
  anchor,
  side = "bottom",
  sideOffset = 8,
  showArrow = true,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "anchor" | "side" | "sideOffset" | "align"> & {
    showArrow?: boolean
  }) {
  return (
    <PopoverPrimitive.Portal container={getAppShellContainer()}>
      <PopoverPrimitive.Positioner
        data-slot="popover-positioner"
        anchor={anchor}
        side={side}
        sideOffset={sideOffset}
        className="z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "w-72 max-w-[calc(100vw-2rem)] rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
          {showArrow && (
            <PopoverPrimitive.Arrow data-slot="popover-arrow">
              <svg width="16" height="8" viewBox="0 0 16 8" className="block">
                <path d="M0 0 L8 8 L16 0 Z" className="fill-popover" />
              </svg>
            </PopoverPrimitive.Arrow>
          )}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverContent }

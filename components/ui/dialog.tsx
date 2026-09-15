"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn, getAppShellContainer } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

// Deliberately no next-intl useTranslations() on the "Close" strings
// below, even though the golden-path i18n pass briefly added it -- this
// is a shared, foundational components/ui/* primitive with no way to
// know whether its caller is rendered inside a NextIntlClientProvider
// (the tenant/platform-admin layouts have one, the root layout and
// every other tree do not, by design -- see app/layout.tsx and
// i18n/request.ts's own header comments). CookieConsentBanner, mounted
// directly in the root layout, proved this the hard way: useTranslations
// throws unconditionally with no provider in scope, and since it ran on
// every render regardless of `open`, it broke the app for effectively
// every visitor the moment this file shipped. A shared primitive should
// never assume a specific app-level context is always available
// upstream -- translate a dialog's own title/description/buttons at the
// CALLER, which knows its own render context, not here.
//
// Vertical-centering fix: DialogContent portals into #app-shell (see
// that function's own comment) so a dialog stays confined to the
// ~430px mobile column on a wide desktop viewport. #app-shell sets
// `contain: layout` to make that containment work for fixed/absolute
// descendants -- but a side effect of `contain: layout` is that
// #app-shell ALSO becomes the containing block for position:fixed
// descendants, so DialogContent's `top-1/2` centers against
// #app-shell's own (possibly much taller than the viewport) content
// height, not the visible viewport. On a short/unscrolled page this
// coincidentally looks right; on a tall page opened after scrolling
// (e.g. Add Expense, reached by scrolling past several dashboard cards
// on the Expenses page) it lands the dialog mostly below the fold,
// cutting off the footer/submit button entirely -- reproduced live and
// previously called out (components/shared/tenant-logo-viewer.tsx's
// own header comment) as a known, "too broad to fix here" quirk. Fixed
// properly here instead of worked around per-dialog: DialogCenterTop
// computes the CURRENT viewport's vertical center relative to
// #app-shell's own (viewport-relative) top edge via
// getBoundingClientRect() -- immune to scroll position or content
// height, since getBoundingClientRect() always reflects where the
// element actually is on screen right now -- and DialogContent applies
// it as an inline `top` style, overriding the CSS `top-1/2` percentage
// (which is what was resolving against the wrong box). Horizontal
// centering is untouched (`left-1/2`): #app-shell's WIDTH doesn't grow
// with content the way its height does, so that axis was never broken.
// Recomputed only when `open` actually flips true (every caller in
// this codebase controls Dialog via a real `open` boolean, none rely
// on DialogTrigger alone) -- not on every re-render, so typing into a
// field while the dialog is open never re-centers/jumps it.
const DialogCenterTopContext = React.createContext<number | null>(null)

function Dialog({ open, ...props }: DialogPrimitive.Root.Props) {
  const [centerTop, setCenterTop] = React.useState<number | null>(null)

  React.useLayoutEffect(() => {
    if (!open) return
    const shell = getAppShellContainer()
    if (!shell) {
      // No #app-shell (auth pages, platform-admin shell) -- Popup then
      // portals straight to <body>, which does NOT redefine the
      // containing block for position:fixed, so the default CSS
      // top-1/2 already centers against the true viewport correctly.
      setCenterTop(null)
      return
    }
    setCenterTop(window.innerHeight / 2 - shell.getBoundingClientRect().top)
  }, [open])

  return (
    <DialogCenterTopContext.Provider value={centerTop}>
      <DialogPrimitive.Root data-slot="dialog" open={open} {...props} />
    </DialogCenterTopContext.Provider>
  )
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  style,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  const centerTop = React.useContext(DialogCenterTopContext)
  return (
    <DialogPortal container={getAppShellContainer()}>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        style={centerTop != null ? { top: centerTop, ...style } : style}
        className={cn(
          // max-h-[85dvh] + overflow-y-auto by default -- without a height
          // cap, a dialog taller than the viewport still centers via
          // top-1/2/-translate-y-1/2 (equal margins top-to-bottom, as
          // intended), but "equal margins" for a box taller than the
          // viewport means BOTH edges sit off-screen: the top of the
          // form (e.g. name/photo fields) ends up pushed above y=0 with
          // no way to scroll up to it, while only the bottom portion
          // stays visible. Capping the box's own height and letting IT
          // scroll internally is what actually keeps every dialog
          // centered with equal margins on a small screen, regardless of
          // how much content it holds.
          //
          // dvh, not vh -- vh is the LAYOUT viewport, which on mobile
          // does not shrink when the on-screen keyboard opens (typing
          // into any field inside a dialog, e.g. Correct Sale's Amount/
          // Reason). The dialog's max-height was computed against a
          // viewport taller than what's actually visible, so its own
          // footer/submit button ended up positioned behind the
          // keyboard with nothing left to scroll -- the container
          // believed it already fit. dvh is the DYNAMIC viewport height,
          // which does react live to the keyboard/toolbar, so the same
          // scroll-internally mechanism above now actually reaches the
          // button. Confirmed live on Correct Sale's dialog.
          //
          // grid-cols-1, not bare grid -- Tailwind's grid-cols-N
          // utilities set grid-template-columns: repeat(N, minmax(0,
          // 1fr)); bare `grid` leaves the implicit column sized `auto`,
          // which (like a flex item's default min-width) lets a grid
          // item's own min-content width force the WHOLE dialog wider
          // than max-w-[calc(100%-2rem)] the moment any descendant has
          // long enough unwrapped text (truncate alone doesn't help --
          // it needs a shrinkable container to truncate WITHIN). Found
          // via RoleFormDialog's permission list on a real device: every
          // row's toggle switch bled off the right edge because the
          // dialog's own grid column had grown to fit the longest
          // permission description in the full catalog, not just
          // whichever fit during a narrower manual test.
          "fixed top-1/2 left-1/2 z-50 grid grid-cols-1 max-h-[85dvh] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-lg"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}

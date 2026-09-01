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
function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
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
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal container={getAppShellContainer()}>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // max-h-[85vh] + overflow-y-auto by default -- without a height
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
          "fixed top-1/2 left-1/2 z-50 grid grid-cols-1 max-h-[85vh] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
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

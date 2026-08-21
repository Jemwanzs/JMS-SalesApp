"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * The single Toaster mounted app-wide (app/layout.tsx) -- every
 * toast.*() call in this codebase (success/info/error/warning/loading,
 * including the admin login-restriction bypass notice) already routes
 * through this one shared instance, so centralizing notifications was a
 * one-line position change, not a bigger refactor: `position="top-
 * center"` (Sonner's built-in centered-horizontally placement, not a
 * true full-screen center, which would sit awkwardly over whatever
 * content is on screen). Sonner has no custom-portal-container prop
 * (unlike the Dialog/Sheet primitives, which portal into #app-shell) --
 * top-center still lines up correctly with the ~430px app shell on a
 * wide desktop viewport anyway, since Sonner centers itself on the same
 * page-center axis the shell's own `justify-center` wrapper already
 * uses, and a toast's own width never approaches the shell's.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-center"
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }

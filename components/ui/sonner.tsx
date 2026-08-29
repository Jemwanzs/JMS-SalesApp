"use client"

import * as React from "react"
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
 *
 * My Preferences (Font/Language): because Sonner always portals to
 * document.body (see above -- it has no container prop), a toast is
 * NEVER a DOM descendant of #app-shell/#platform-admin-shell, so it
 * can't pick up data-font/dir via ordinary CSS scoping/inheritance the
 * way everything else in the app now does (see those shells' own
 * font-sans comments). This reads the shell's own already-resolved
 * data-font/dir straight off the DOM instead -- no new fetch, no extra
 * per-user state to keep in sync, just mirroring what the server
 * already decided. A MutationObserver (not a one-time read) keeps this
 * live across an optimistic font-preference change (FontPreferenceCard
 * flips #app-shell's attribute immediately, before the server action
 * confirms) and across a language change's router.refresh().
 */
const KNOWN_FONT_VARS = new Set(["outfit", "inter", "roboto", "poppins", "lato"])

function useShellFontAndDir(): { fontFamily: string; dir: "ltr" | "rtl" } {
  const [state, setState] = React.useState<{ fontFamily: string; dir: "ltr" | "rtl" }>({
    fontFamily: "var(--font-outfit)",
    dir: "ltr",
  })

  React.useEffect(() => {
    const shell = document.getElementById("app-shell") ?? document.getElementById("platform-admin-shell")
    if (!shell) return

    function sync() {
      const font = shell!.getAttribute("data-font") ?? "outfit";
      setState({
        fontFamily: `var(--font-${KNOWN_FONT_VARS.has(font) ? font : "outfit"})`,
        dir: shell!.getAttribute("dir") === "rtl" ? "rtl" : "ltr",
      });
    }

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(shell, { attributes: true, attributeFilter: ["data-font", "dir"] });
    return () => observer.disconnect();
  }, []);

  return state;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const { fontFamily, dir } = useShellFontAndDir()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-center"
      dir={dir}
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
          fontFamily,
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

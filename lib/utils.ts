import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * The ~430px mobile shell rendered by app/(tenant)/t/[tenantSlug]/
 * layout.tsx (id="app-shell", `contain: layout` so it's a containing
 * block for fixed/absolute descendants too). Sheet/Dialog portal into
 * this instead of the default <body> so a bottom sheet or centered
 * dialog stays within the mobile column on a wide desktop viewport
 * rather than spanning/centering on the full browser window. Only
 * evaluated once a portal actually opens (client-side, well after
 * hydration), so there's no server/client value mismatch to worry
 * about. Falls back to Base UI's own default (<body>) wherever the
 * shell doesn't exist -- auth pages, the platform-admin shell, etc.
 */
export function getAppShellContainer(): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined
  return document.getElementById("app-shell") ?? undefined
}

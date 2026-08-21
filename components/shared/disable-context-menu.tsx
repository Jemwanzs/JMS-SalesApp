"use client";

import { useEffect } from "react";

/**
 * Blocks the browser's right-click context menu app-wide (spec: Product
 * Enhancements #4 -- "an additional UI restriction"). Deliberately NOT a
 * security control: DevTools, disabling JS, or a browser extension all
 * bypass this trivially, so every real protection (RLS, has_permission,
 * server-side validation) must keep working exactly as if this component
 * didn't exist -- it only removes one casual, low-effort way to copy
 * on-screen content or images.
 */
export function DisableContextMenu() {
  useEffect(() => {
    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
    }
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  return null;
}

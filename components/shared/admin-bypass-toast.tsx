"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

const MESSAGES: Record<string, string> = {
  working_hours:
    "Sign-in is currently restricted to business hours for other users in your business — you're exempt as an admin.",
  geofence:
    "Sign-in is currently restricted to your workplace location for other users in your business — you're exempt as an admin.",
};

/**
 * One-time notice for an admin whose login just bypassed a working-
 * hours/geofence restriction that would have blocked anyone else (see
 * AuthService.evaluateAccessGate's settings.manage exemption). Reads the
 * `adminBypass` query param the sign-in redirect appends, shows it once
 * on mount, then strips the param via router.replace so a page refresh
 * doesn't repeat it.
 */
export function AdminBypassToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const bypass = searchParams.get("adminBypass");
    if (!bypass) return;

    toast.info(MESSAGES[bypass] ?? "A login restriction was bypassed for your admin account.");

    const params = new URLSearchParams(searchParams);
    params.delete("adminBypass");
    router.replace(params.size > 0 ? `${pathname}?${params}` : pathname);
    // Deliberately excludes searchParams/router/pathname from deps --
    // this should only ever fire once, right after the param first
    // appears, not re-fire from the replace() call's own re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

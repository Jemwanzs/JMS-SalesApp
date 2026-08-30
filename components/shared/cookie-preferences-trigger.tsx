"use client";

import { useState } from "react";
import { toast } from "sonner";

import { CookieSettingsDialog } from "@/components/shared/cookie-settings-dialog";
import { readCookieConsent } from "@/lib/consent/cookie-consent";

/**
 * Privacy Policy's own re-entry point into cookie preferences, reusing
 * the same CookieSettingsDialog the initial banner uses -- a small
 * client island inside an otherwise fully static/server-rendered page
 * (see PrivacyPolicyPage's own file, no "use client" there).
 */
export function CookiePreferencesTrigger() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-block rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
      >
        Manage Cookie Preferences
      </button>
      {/* Only mounted once actually opened -- rendering the Dialog/Switch
          tree unconditionally would server-prerender it on this static
          page (unlike CookieConsentBanner, which stays null server-side
          until a client-only useEffect flips it), which broke the
          build. */}
      {open && (
        <CookieSettingsDialog
          open={open}
          onOpenChange={setOpen}
          initialAnalytics={readCookieConsent()?.analytics ?? false}
          onSaved={() => toast.success("Cookie preferences saved")}
        />
      )}
    </>
  );
}

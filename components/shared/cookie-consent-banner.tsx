"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { CookieSettingsDialog } from "@/components/shared/cookie-settings-dialog";
import { readCookieConsent, writeCookieConsent } from "@/lib/consent/cookie-consent";

/**
 * Mounted once in app/layout.tsx, at the true root -- purely client-side
 * (checks localStorage on mount, nothing server-rendered), so the root
 * layout stays fully static, same constraint every other per-user
 * preference this session has respected. Renders nothing until the
 * first client render confirms no consent is on file yet, and nothing
 * again once a choice has been saved (readCookieConsent handles both
 * "Accept All" and "Essential Only" the same way -- both are a real,
 * saved choice, just with a different `analytics` value). Re-opening
 * later happens from the Privacy Policy page's own "Manage Cookie
 * Preferences" trigger, a separate CookieSettingsDialog instance --
 * once this banner is dismissed it has nothing left to render.
 */
export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setVisible(readCookieConsent() === null);
  }, []);

  if (!visible) {
    return null;
  }

  function acceptAll() {
    writeCookieConsent(true);
    setVisible(false);
  }

  function essentialOnly() {
    writeCookieConsent(false);
    setVisible(false);
  }

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[430px] border-t bg-card p-4 text-sm shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
        <p className="font-medium">Help us make JMS Sales easier to find and use</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          We use essential cookies to keep the app working, remember your preferences and improve your experience.
          With your permission, additional cookies may also help improve how you find and access JMS Sales online.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={acceptAll}>
            Accept All
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={essentialOnly}>
            Essential Only
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSettingsOpen(true)}>
            Cookie Settings
          </Button>
        </div>
      </div>

      <CookieSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={() => setVisible(false)}
      />
    </>
  );
}

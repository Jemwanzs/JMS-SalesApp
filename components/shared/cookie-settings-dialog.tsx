"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { writeCookieConsent } from "@/lib/consent/cookie-consent";

/**
 * Shared by CookieConsentBanner's own "Cookie Settings" action and the
 * Privacy Policy page's "Manage Cookie Preferences" link -- one dialog,
 * two entry points, so changing a preference later works the same way
 * it was set the first time.
 */
export function CookieSettingsDialog({
  open,
  onOpenChange,
  onSaved,
  initialAnalytics = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (analytics: boolean) => void;
  initialAnalytics?: boolean;
}) {
  const [analytics, setAnalytics] = useState(initialAnalytics);

  function save() {
    writeCookieConsent(analytics);
    onSaved(analytics);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cookie Settings</DialogTitle>
          <DialogDescription>
            Choose which cookies JMS Sales can use on this device. You can change this at any time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Essential</p>
              <p className="text-xs text-muted-foreground">
                Required to keep you signed in and the app working. Always on.
              </p>
            </div>
            <Switch checked disabled aria-label="Essential cookies (always on)" />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Analytics</p>
              <p className="text-xs text-muted-foreground">
                Helps us understand how JMS Sales is used, so we can improve it.
              </p>
            </div>
            <Switch checked={analytics} onCheckedChange={setAnalytics} aria-label="Analytics cookies" />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" onClick={save} className="w-full">
            Save preferences
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

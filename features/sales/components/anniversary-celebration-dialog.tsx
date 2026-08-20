"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * The tenant-shell layout already shows a small, low-key text banner for
 * any wish sent in the last 7 days (app/(tenant)/t/[tenantSlug]/layout.tsx,
 * AnniversaryService.getActiveWish) -- this is the louder, one-day-only
 * celebration on top of that: a real popup, specifically on the Capture
 * Sales landing page, only while `wish.sentAtDate === todayDate` (the
 * actual anniversary day, tenant-timezone-scoped). It reappears each new
 * browser session that day (sessionStorage, not localStorage) rather than
 * being permanently dismissed after the first close, matching "pops up
 * the whole day" rather than "pops up once, ever". Uses the SAME wish
 * data AnniversaryService already resolves per-tenant (is_tenant_member-
 * gated RLS on anniversary_wishes) -- every member of THIS tenant sees
 * it, nothing from another tenant can ever reach this component.
 */
export function AnniversaryCelebrationDialog({
  wishId,
  message,
}: {
  wishId: string;
  message: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const key = `anniversary-wish-seen:${wishId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    setOpen(true);
  }, [wishId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="text-center">
        <DialogHeader>
          <DialogTitle className="text-center text-2xl">🌸🎉🌷🎈🌺</DialogTitle>
        </DialogHeader>
        <p className="text-base font-medium">{message}</p>
        <DialogFooter className="sm:justify-center">
          <Button onClick={() => setOpen(false)}>Thank you! 💐</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

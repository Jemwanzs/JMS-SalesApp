"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { XIcon } from "lucide-react";

import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";

/**
 * Tenant-controlled promotional splash (Platform Admin -> Tenant Detail
 * -> "Login welcome banner", tenant_settings.show_welcome_banner) --
 * shown once per real login on the Record Sales landing page, right
 * after branch selection. Same "sessionStorage seen-check in a client
 * useEffect" shape as AnniversaryCelebrationDialog, but keyed by
 * Supabase Auth's own `session_id` JWT claim instead of a static id --
 * that claim changes only on a genuinely new login (see migration
 * 0050's own comment), so this naturally resets after logout/login
 * again but never re-fires on ordinary navigation or a page refresh
 * within the same session.
 *
 * p-0/overflow-hidden on DialogContent lets the artwork's own baked-in
 * rounded corners align with the shared popup's rounded-xl shape
 * ("curved edges") without double-rounding; the primitive's existing
 * max-h-[85dvh]/overflow-y-auto cap (and its viewport-centering fix)
 * already guarantee this never gets cut off on any screen. Not
 * clickable, per spec -- no onClick on the image, the artwork's own
 * "Let's Get Started" text is decorative, not an interactive control.
 *
 * Close button: NOT the shared DialogContent's built-in one
 * (showCloseButton={false}) -- that one is a plain near-black ghost
 * icon with a transparent background, which disappears against this
 * artwork's own dark-green top-right corner (verified live: present
 * and clickable in the DOM, but visually unreadable). A dark, semi-
 * opaque circular backdrop behind a white X guarantees contrast
 * against ANY banner image, not just this one.
 */
export function WelcomeBannerDialog({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const key = `welcome-banner-seen:${sessionId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    setOpen(true);
  }, [sessionId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-sm overflow-hidden p-0 sm:max-w-md"
        aria-label="Welcome to JMS App"
        showCloseButton={false}
      >
        <Image
          src="/login-bg/JMS-App-Banner.png"
          alt="Welcome to JMS App"
          width={1536}
          height={1024}
          className="h-auto w-full"
          priority
        />
        <DialogClose
          className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
          aria-label="Close"
        >
          <XIcon className="h-4 w-4" />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

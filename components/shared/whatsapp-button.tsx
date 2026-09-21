"use client";

import { buildWhatsAppLink } from "@/lib/utils/whatsapp-link";
import { cn } from "@/lib/utils";
import { WhatsAppIcon } from "@/components/shared/whatsapp-icon";

/**
 * Opens the customer's own WhatsApp with an optional prefilled message
 * -- never sends anything itself, see lib/utils/whatsapp-link.ts's own
 * header comment. `stopPropagation` is defensive: several call sites
 * place this inside a "stretched link" row (a full-row <Link> overlay)
 * where it's required for the icon to stay independently clickable; it
 * is harmless everywhere else this renders (plain, non-Link cards).
 */
export function WhatsAppButton({
  mobile,
  message,
  className,
  label = "Message on WhatsApp",
}: {
  mobile: string;
  message?: string;
  className?: string;
  label?: string;
}) {
  return (
    <a
      href={buildWhatsAppLink(mobile, message)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "relative z-10 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white transition-opacity hover:opacity-90",
        className
      )}
    >
      <WhatsAppIcon className="h-4 w-4" />
    </a>
  );
}

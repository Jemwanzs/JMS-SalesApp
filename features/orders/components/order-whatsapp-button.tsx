"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { getOrderReceiptDataAction } from "@/features/orders/actions/get-order-receipt-data";
import { WhatsAppIcon } from "@/components/shared/whatsapp-icon";
import { buildOrderReceiptPdf } from "@/lib/utils/generate-order-receipt-pdf";
import { buildWhatsAppLink } from "@/lib/utils/whatsapp-link";
import { cn } from "@/lib/utils";

/**
 * A literal wa.me link can't attach a file -- that URL scheme only ever
 * supports a `text` param, by WhatsApp's own design (see
 * lib/utils/whatsapp-link.ts's own header comment). The closest real
 * equivalent: generate the receipt PDF and hand it to the Web Share
 * API, which on a phone opens the OS's native share sheet with
 * WhatsApp as one of the targets -- picking it attaches the PDF
 * automatically, the same mechanism OrderReceiptDialog's own "Share"
 * button already uses. Falls back to a plain wa.me chat (text only,
 * synchronous, no receipt) whenever the richer path isn't available:
 * the viewer lacks orders.download_receipts, the browser doesn't
 * support sharing files (most desktop browsers), or the share sheet
 * itself fails/is cancelled.
 */
export function OrderWhatsAppButton({
  tenantId,
  orderId,
  mobile,
  message,
  canAttachReceipt,
  className,
}: {
  tenantId: string;
  orderId: string;
  mobile: string;
  message?: string;
  canAttachReceipt: boolean;
  className?: string;
}) {
  const [isPreparing, setIsPreparing] = useState(false);

  function openPlainChat() {
    window.open(buildWhatsAppLink(mobile, message), "_blank", "noopener,noreferrer");
  }

  async function onClick(e: React.MouseEvent) {
    e.stopPropagation();

    if (!canAttachReceipt || !navigator.canShare) {
      openPlainChat();
      return;
    }

    setIsPreparing(true);
    try {
      const data = await getOrderReceiptDataAction(tenantId, orderId);
      if (!data) {
        openPlainChat();
        return;
      }
      const doc = await buildOrderReceiptPdf(data);
      const blob = doc.output("blob") as Blob;
      const file = new File([blob], `Receipt-${data.orderNumber ?? orderId}.pdf`, { type: "application/pdf" });

      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text: message });
          return;
        } catch {
          // User cancelled the share sheet, or it failed -- fall through to a plain chat link.
        }
      }
      openPlainChat();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not prepare the receipt -- opening WhatsApp without it");
      openPlainChat();
    } finally {
      setIsPreparing(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPreparing}
      aria-label={canAttachReceipt ? "Message on WhatsApp with receipt" : "Message on WhatsApp"}
      title={canAttachReceipt ? "Message on WhatsApp with receipt" : "Message on WhatsApp"}
      className={cn(
        "relative z-10 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white transition-opacity hover:opacity-90 disabled:opacity-60",
        className
      )}
    >
      {isPreparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <WhatsAppIcon className="h-4 w-4" />}
    </button>
  );
}

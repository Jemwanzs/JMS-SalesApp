"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import Image from "next/image";

import { getOrderReceiptDataAction } from "@/features/orders/actions/get-order-receipt-data";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildOrderReceiptPdf } from "@/lib/utils/generate-order-receipt-pdf";
import type { OrderReceiptData } from "@/services/OrderService";

const STATUS_LABEL: Record<OrderReceiptData["status"], string> = {
  received: "RECEIVED",
  being_attended: "BEING PREPARED",
  on_delivery: "ON DELIVERY",
  completed: "COMPLETED",
  cancelled: "CANCELLED",
  rejected: "REJECTED",
};

/**
 * Same trigger/fetch/build shape as DailyReportDialog -- open the
 * dialog, fetch the receipt data once (cached for the dialog's
 * lifetime), render a hand-styled preview matching the actual PDF
 * layout, and build the SAME jsPDF doc from that already-fetched data
 * for both Download (`.save()`) and Share (Web Share API with the PDF
 * as a File -- on mobile this is what actually gets the receipt into
 * WhatsApp, since a plain wa.me link can't attach a file).
 *
 * canDownload=false still shows the dialog (View Receipt) but hides the
 * Download/Share buttons -- spec section 14 treats "view" and
 * "download" as genuinely separate permissions.
 */
export function OrderReceiptDialog({ tenantId, orderId, canDownload }: { tenantId: string; orderId: string; canDownload: boolean }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<OrderReceiptData | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isExporting, startExporting] = useTransition();

  function onOpen() {
    setOpen(true);
    if (data) return;
    startLoading(async () => {
      try {
        const result = await getOrderReceiptDataAction(tenantId, orderId);
        if (!result) {
          toast.error("Could not load this receipt");
          setOpen(false);
          return;
        }
        setData(result);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load this receipt");
        setOpen(false);
      }
    });
  }

  function download() {
    if (!data) return;
    startExporting(async () => {
      const doc = await buildOrderReceiptPdf(data);
      doc.save(`Receipt-${data.orderNumber ?? orderId}.pdf`);
    });
  }

  function share() {
    if (!data) return;
    startExporting(async () => {
      const doc = await buildOrderReceiptPdf(data);
      const blob = doc.output("blob") as Blob;
      const file = new File([blob], `Receipt-${data.orderNumber ?? orderId}.pdf`, { type: "application/pdf" });

      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `Receipt ${data.orderNumber ?? ""}` });
          return;
        } catch {
          // User cancelled the share sheet, or it failed -- fall through to a plain download.
        }
      }
      doc.save(`Receipt-${data.orderNumber ?? orderId}.pdf`);
    });
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={onOpen}>
        Receipt
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Order Receipt</DialogTitle>
          </DialogHeader>

          {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Loading...</p>}

          {data && !isLoading && (
            <div
              className="mx-auto w-full max-w-[280px] space-y-2 rounded-lg p-4 text-center text-xs"
              style={{ backgroundColor: data.backgroundColor, color: data.textColor }}
            >
              {data.logoUrl && (
                <div className="mx-auto h-12 w-12 overflow-hidden rounded">
                  <Image src={data.logoUrl} alt="" width={48} height={48} className="h-full w-full object-contain" />
                </div>
              )}
              <p className="text-sm font-bold">{data.outletName}</p>
              <p className="opacity-90">ORDER RECEIPT</p>

              <div className="border-t border-dashed opacity-50" />
              {data.orderNumber && <p className="font-semibold">{data.orderNumber}</p>}
              <p className="opacity-80">{new Date(data.createdAt).toLocaleString()}</p>

              <div className="border-t border-dashed opacity-50" />
              <div className="space-y-0.5 text-left">
                <p className="font-semibold opacity-90">CUSTOMER</p>
                <p>{data.customerName}</p>
                {data.showCustomerMobile && <p>{data.customerMobile}</p>}
                <p>{data.deliveryLocation}</p>
              </div>

              <div className="border-t border-dashed opacity-50" />
              <div className="space-y-1 text-left">
                <p className="font-semibold opacity-90">ORDER</p>
                {data.items.map((item, i) => (
                  <div key={i} className="flex items-start justify-between gap-2">
                    <span className="min-w-0">{item.name}</span>
                    <span className="shrink-0">{item.amount.toFixed(2)}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-dashed opacity-50" />
              <div className="flex items-center justify-between font-bold">
                <span>ORDER TOTAL</span>
                <span>{data.orderTotal.toFixed(2)}</span>
              </div>
              <p className="opacity-80">Delivery fee payable separately on delivery</p>

              <div className="border-t border-dashed opacity-50" />
              <div className="space-y-0.5 text-left">
                <p className="font-semibold opacity-90">STATUS</p>
                <p className="font-bold">{STATUS_LABEL[data.status]}</p>
                {data.showDeliveryPerson && data.deliveryPersonName && (data.status === "on_delivery" || data.status === "completed") && (
                  <>
                    <p className="mt-1 font-semibold opacity-90">DELIVERY BY</p>
                    <p>{data.deliveryPersonName}</p>
                    {data.deliveryPersonMobile && <p>{data.deliveryPersonMobile}</p>}
                  </>
                )}
                {data.status === "cancelled" && data.cancellationReason && (
                  <>
                    <p className="mt-1 font-semibold opacity-90">CANCELLATION REASON</p>
                    <p>{data.cancellationReason}</p>
                  </>
                )}
              </div>

              <div className="border-t border-dashed opacity-50" />
              <p className="opacity-90">{data.footerMessage}</p>
              <p className="text-sm font-bold">{data.outletName}</p>
            </div>
          )}

          {canDownload && (
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" disabled={!data || isExporting} onClick={share} className="flex-1">
                Share
              </Button>
              <Button type="button" disabled={!data || isExporting} onClick={download} className="flex-1">
                {isExporting ? "Preparing..." : "Download PDF"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

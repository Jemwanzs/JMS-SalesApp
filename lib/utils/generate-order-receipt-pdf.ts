import { fetchImageAsDataUrl, type RasterImage } from "@/lib/utils/fetch-image-as-data-url";
import type { OrderReceiptData } from "@/services/OrderService";

const MARGIN_MM = 4;
const LOGO_SIZE_MM = 16;
const DIVIDER_HEIGHT_MM = 3;
const SPACER_SM_MM = 1.5;
const SPACER_MD_MM = 3;
const LINE_HEIGHT_BODY_MM = 4;
const LINE_HEIGHT_TITLE_MM = 5;

type JsPdfDoc = InstanceType<typeof import("jspdf").default>;

type Segment =
  | { kind: "line"; text: string; align: "left" | "center" | "right"; fontSize: number; bold: boolean; heightMm: number }
  | { kind: "row"; left: string; right: string; fontSize: number; bold: boolean; heightMm: number }
  | { kind: "divider"; heightMm: number }
  | { kind: "spacer"; heightMm: number }
  | { kind: "logo"; dataUrl: string; format: "PNG" | "JPEG" | "WEBP"; heightMm: number };

function jsPdfImageFormat(mimeType: string): "PNG" | "JPEG" | "WEBP" {
  if (mimeType === "image/jpeg") return "JPEG";
  if (mimeType === "image/webp") return "WEBP";
  return "PNG";
}

const STATUS_LABEL: Record<OrderReceiptData["status"], string> = {
  received: "RECEIVED",
  being_attended: "BEING PREPARED",
  on_delivery: "ON DELIVERY",
  completed: "COMPLETED",
  cancelled: "CANCELLED",
  rejected: "REJECTED",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Builds the flat, already-line-wrapped segment list a "POS-style"
 * receipt is drawn from. Takes a throwaway jsPDF instance purely for
 * its font-metrics API (`splitTextToSize`) -- these work independent of
 * the doc's own page size, so the SAME segment array this function
 * returns is reused verbatim by both the height-measuring pass and the
 * real drawing pass in buildOrderReceiptPdf(), with no risk of the two
 * passes drifting apart.
 */
function buildSegments(data: OrderReceiptData, contentWidthMm: number, measureDoc: JsPdfDoc, logo: RasterImage | null): Segment[] {
  const segments: Segment[] = [];
  const wrap = (text: string, fontSize: number, bold: boolean): string[] => {
    measureDoc.setFont("helvetica", bold ? "bold" : "normal");
    measureDoc.setFontSize(fontSize);
    return measureDoc.splitTextToSize(text, contentWidthMm) as string[];
  };
  const addWrapped = (text: string, opts: { align?: "left" | "center" | "right"; fontSize?: number; bold?: boolean } = {}) => {
    const fontSize = opts.fontSize ?? 8;
    const bold = opts.bold ?? false;
    for (const line of wrap(text, fontSize, bold)) {
      segments.push({ kind: "line", text: line, align: opts.align ?? "left", fontSize, bold, heightMm: LINE_HEIGHT_BODY_MM });
    }
  };

  segments.push({ kind: "spacer", heightMm: SPACER_MD_MM });

  if (logo) {
    segments.push({ kind: "logo", dataUrl: logo.dataUrl, format: jsPdfImageFormat(logo.mimeType), heightMm: LOGO_SIZE_MM });
    segments.push({ kind: "spacer", heightMm: SPACER_SM_MM });
  }

  addWrapped(data.outletName, { align: "center", fontSize: 11, bold: true });
  segments.push({ kind: "spacer", heightMm: SPACER_SM_MM });
  addWrapped("ORDER RECEIPT", { align: "center", fontSize: 8, bold: false });
  segments.push({ kind: "spacer", heightMm: SPACER_MD_MM });

  if (data.orderNumber) addWrapped(data.orderNumber, { align: "center", fontSize: 9, bold: true });
  addWrapped(formatDate(data.createdAt), { align: "center", fontSize: 7.5 });
  segments.push({ kind: "divider", heightMm: DIVIDER_HEIGHT_MM });

  addWrapped("CUSTOMER", { fontSize: 7.5, bold: true });
  segments.push({ kind: "spacer", heightMm: SPACER_SM_MM });
  addWrapped(data.customerName, { fontSize: 8.5 });
  if (data.showCustomerMobile) addWrapped(data.customerMobile, { fontSize: 8 });
  addWrapped(data.deliveryLocation, { fontSize: 8 });
  segments.push({ kind: "divider", heightMm: DIVIDER_HEIGHT_MM });

  addWrapped("ORDER", { fontSize: 7.5, bold: true });
  segments.push({ kind: "spacer", heightMm: SPACER_SM_MM });
  for (const item of data.items) {
    measureDoc.setFont("helvetica", "normal");
    measureDoc.setFontSize(8.5);
    const nameLines = measureDoc.splitTextToSize(item.name, contentWidthMm * 0.65) as string[];
    nameLines.forEach((line, i) => {
      if (i === 0) {
        segments.push({ kind: "row", left: line, right: item.amount.toFixed(2), fontSize: 8.5, bold: false, heightMm: LINE_HEIGHT_BODY_MM });
      } else {
        segments.push({ kind: "line", text: line, align: "left", fontSize: 8.5, bold: false, heightMm: LINE_HEIGHT_BODY_MM });
      }
    });
    segments.push({ kind: "spacer", heightMm: SPACER_SM_MM });
  }
  segments.push({ kind: "divider", heightMm: DIVIDER_HEIGHT_MM });

  segments.push({
    kind: "row",
    left: "ORDER TOTAL",
    right: data.orderTotal.toFixed(2),
    fontSize: 9.5,
    bold: true,
    heightMm: LINE_HEIGHT_TITLE_MM,
  });
  segments.push({ kind: "spacer", heightMm: SPACER_SM_MM });
  addWrapped("DELIVERY FEE", { fontSize: 7.5, bold: true });
  addWrapped("Payable separately on delivery", { fontSize: 7.5 });
  segments.push({ kind: "divider", heightMm: DIVIDER_HEIGHT_MM });

  addWrapped("STATUS", { fontSize: 7.5, bold: true });
  addWrapped(STATUS_LABEL[data.status], { fontSize: 8.5, bold: true });

  if (data.showDeliveryPerson && data.deliveryPersonName && (data.status === "on_delivery" || data.status === "completed")) {
    segments.push({ kind: "spacer", heightMm: SPACER_SM_MM });
    addWrapped("DELIVERY BY", { fontSize: 7.5, bold: true });
    addWrapped(data.deliveryPersonName, { fontSize: 8.5 });
    if (data.deliveryPersonMobile) addWrapped(data.deliveryPersonMobile, { fontSize: 8 });
  }

  if (data.status === "cancelled" && data.cancellationReason) {
    segments.push({ kind: "spacer", heightMm: SPACER_SM_MM });
    addWrapped("CANCELLATION REASON", { fontSize: 7.5, bold: true });
    addWrapped(data.cancellationReason, { fontSize: 8 });
  }

  segments.push({ kind: "divider", heightMm: DIVIDER_HEIGHT_MM });
  addWrapped(data.footerMessage, { align: "center", fontSize: 7.5 });
  segments.push({ kind: "spacer", heightMm: SPACER_SM_MM });
  addWrapped(data.outletName, { align: "center", fontSize: 7.5, bold: true });
  segments.push({ kind: "spacer", heightMm: SPACER_MD_MM });

  return segments;
}

function totalHeightMm(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + s.heightMm, 0);
}

function drawSegments(doc: JsPdfDoc, segments: Segment[], widthMm: number, textColor: string) {
  const contentWidthMm = widthMm - MARGIN_MM * 2;
  const centerX = widthMm / 2;
  const rightX = widthMm - MARGIN_MM;
  let y = 0;

  for (const seg of segments) {
    if (seg.kind === "spacer") {
      y += seg.heightMm;
      continue;
    }
    if (seg.kind === "divider") {
      y += seg.heightMm / 2;
      doc.setDrawColor(textColor);
      doc.setLineDashPattern([0.8, 0.8], 0);
      doc.line(MARGIN_MM, y, rightX, y);
      doc.setLineDashPattern([], 0);
      y += seg.heightMm / 2;
      continue;
    }
    if (seg.kind === "logo") {
      doc.addImage(seg.dataUrl, seg.format, centerX - LOGO_SIZE_MM / 2, y, LOGO_SIZE_MM, LOGO_SIZE_MM);
      y += seg.heightMm;
      continue;
    }
    doc.setTextColor(textColor);
    if (seg.kind === "row") {
      doc.setFont("helvetica", seg.bold ? "bold" : "normal");
      doc.setFontSize(seg.fontSize);
      doc.text(seg.left, MARGIN_MM, y + seg.heightMm - 1);
      doc.text(seg.right, rightX, y + seg.heightMm - 1, { align: "right" });
      y += seg.heightMm;
      continue;
    }
    doc.setFont("helvetica", seg.bold ? "bold" : "normal");
    doc.setFontSize(seg.fontSize);
    const x = seg.align === "center" ? centerX : seg.align === "right" ? rightX : MARGIN_MM;
    doc.text(seg.text, x, y + seg.heightMm - 1, { align: seg.align });
    y += seg.heightMm;
  }
}

/**
 * The compact "POS-style" order receipt (80mm/58mm wide, height grows
 * to fit content -- no jsPDF/expense-report precedent for this exists
 * in the codebase, both siblings are fixed-A4 with page breaks). Two
 * passes over the SAME segment array (buildSegments): pass 1 sums
 * segment heights using a throwaway doc's font metrics; pass 2
 * instantiates the real doc at `[widthMm, computedHeightMm]`, fills the
 * whole page with the tenant's background color, and redraws. A failed/
 * SVG logo (fetchImageAsDataUrl returns null) never blocks generation
 * -- the receipt just renders text-only branding.
 */
export async function buildOrderReceiptPdf(data: OrderReceiptData): Promise<JsPdfDoc> {
  const { default: jsPDF } = await import("jspdf");

  const widthMm = data.receiptWidth === "58mm" ? 58 : 80;
  const contentWidthMm = widthMm - MARGIN_MM * 2;

  const logo = data.logoUrl ? await fetchImageAsDataUrl(data.logoUrl) : null;

  const measureDoc = new jsPDF({ unit: "mm", format: [widthMm, 200] });
  const segments = buildSegments(data, contentWidthMm, measureDoc, logo);
  const heightMm = Math.max(totalHeightMm(segments), 40);

  const doc = new jsPDF({ unit: "mm", format: [widthMm, heightMm] });
  doc.setFillColor(data.backgroundColor);
  doc.rect(0, 0, widthMm, heightMm, "F");
  drawSegments(doc, segments, widthMm, data.textColor);

  return doc;
}

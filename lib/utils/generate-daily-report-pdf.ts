import type { DailySalesReportData } from "@/features/sales/actions/get-daily-sales-report";

const PAGE_WIDTH_MM = 210;
const MARGIN_MM = 18;
const RIGHT_EDGE_MM = PAGE_WIDTH_MM - MARGIN_MM;

function formatReportDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Builds the Product Enhancements #7 Daily Report PDF -- a clean,
 * single-column document (Header: business name/admin email/date/
 * separator; Content: totals + a per-product amount/qty table; Footer:
 * "system-generated" note + timestamp, no signature). jsPDF is dynamic-
 * imported here rather than at module scope so it's code-split out of
 * the Sales History bundle and only fetched when someone actually opens
 * the Daily Report dialog.
 */
export async function buildDailySalesReportPdf(data: DailySalesReportData) {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = 22;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(data.tenantName || "Business", MARGIN_MM, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100);
  if (data.adminEmail) {
    doc.text(`Admin: ${data.adminEmail}`, MARGIN_MM, y);
    y += 5;
  }
  doc.text(`Report Date: ${formatReportDate(data.reportDate)}`, MARGIN_MM, y);
  y += 6;

  doc.setDrawColor(200);
  doc.line(MARGIN_MM, y, RIGHT_EDGE_MM, y);
  y += 10;

  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Daily Sales Summary", MARGIN_MM, y);
  y += 9;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Total Sales: ${data.currency} ${data.totalSalesAmount.toFixed(2)}`, MARGIN_MM, y);
  y += 6;
  doc.text(`Transactions: ${data.transactionCount}`, MARGIN_MM, y);
  y += 10;

  const hasQuantity = data.products.some((p) => p.quantity !== null);
  const qtyX = 140;
  const amountX = RIGHT_EDGE_MM;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Product", MARGIN_MM, y);
  if (hasQuantity) doc.text("Qty", qtyX, y);
  doc.text("Amount", amountX, y, { align: "right" });
  y += 2;
  doc.setDrawColor(220);
  doc.line(MARGIN_MM, y, RIGHT_EDGE_MM, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  for (const product of data.products) {
    if (y > 270) {
      doc.addPage();
      y = 22;
    }
    doc.text(product.name, MARGIN_MM, y, { maxWidth: qtyX - MARGIN_MM - 4 });
    if (hasQuantity && product.quantity !== null) {
      doc.text(String(product.quantity), qtyX, y);
    }
    doc.text(`${data.currency} ${product.amount.toFixed(2)}`, amountX, y, { align: "right" });
    y += 6;
  }

  if (data.products.length === 0) {
    doc.setTextColor(140);
    doc.text("No sales recorded for this date.", MARGIN_MM, y);
    y += 6;
  }

  if (y > 265) {
    doc.addPage();
    y = 22;
  }
  y += 4;
  doc.setDrawColor(200);
  doc.line(MARGIN_MM, y, RIGHT_EDGE_MM, y);
  y += 9;

  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(`Daily Total: ${data.currency} ${data.totalSalesAmount.toFixed(2)}`, MARGIN_MM, y);

  const footerY = Math.max(y + 15, 280);
  if (footerY > 290) {
    doc.addPage();
  }
  const finalFooterY = footerY > 290 ? 275 : footerY;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(130);
  doc.text("This is a system-generated report.", MARGIN_MM, finalFooterY);
  doc.text(`Generated on ${new Date(data.generatedAt).toLocaleString()}`, MARGIN_MM, finalFooterY + 4);

  return doc;
}

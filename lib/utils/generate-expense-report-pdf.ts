import type { ExpenseReportData } from "@/features/expenses/actions/get-expense-report";

const PAGE_WIDTH_MM = 210;
const MARGIN_MM = 18;
const RIGHT_EDGE_MM = PAGE_WIDTH_MM - MARGIN_MM;

function formatDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/**
 * Same layout shape as generate-daily-report-pdf.ts (Header: business
 * name/date range/separator; Content: totals + one breakdown-dimension
 * table; Footer: system-generated note + timestamp) -- a table-per-
 * breakdown-dimension report rather than 11 bespoke named reports,
 * matching how Sales Reports already works. jsPDF is dynamic-imported so
 * it stays code-split out of the Expense Summary bundle.
 */
export async function buildExpenseReportPdf(data: ExpenseReportData) {
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
  const rangeLabel = data.fromDate === data.toDate ? formatDate(data.fromDate) : `${formatDate(data.fromDate)} — ${formatDate(data.toDate)}`;
  doc.text(`Expense Report: ${rangeLabel}`, MARGIN_MM, y);
  y += 6;

  doc.setDrawColor(200);
  doc.line(MARGIN_MM, y, RIGHT_EDGE_MM, y);
  y += 10;

  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(`Expense Summary — ${data.dimensionLabel}`, MARGIN_MM, y);
  y += 9;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Total Expenses: ${data.currency} ${data.totalAmount.toFixed(2)}`, MARGIN_MM, y);
  y += 6;
  doc.text(`Number of Expenses: ${data.count}`, MARGIN_MM, y);
  y += 10;

  const amountX = RIGHT_EDGE_MM;
  const countX = 150;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(data.dimensionLabel.replace("By ", ""), MARGIN_MM, y);
  doc.text("Count", countX, y);
  doc.text("Amount", amountX, y, { align: "right" });
  y += 2;
  doc.setDrawColor(220);
  doc.line(MARGIN_MM, y, RIGHT_EDGE_MM, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  for (const entry of data.entries) {
    if (y > 270) {
      doc.addPage();
      y = 22;
    }
    doc.text(entry.label, MARGIN_MM, y, { maxWidth: countX - MARGIN_MM - 4 });
    doc.text(String(entry.count), countX, y);
    doc.text(`${data.currency} ${entry.total.toFixed(2)}`, amountX, y, { align: "right" });
    y += 6;
  }

  if (data.entries.length === 0) {
    doc.setTextColor(140);
    doc.text("No expenses recorded for this range.", MARGIN_MM, y);
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
  doc.text(`Total: ${data.currency} ${data.totalAmount.toFixed(2)}`, MARGIN_MM, y);

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

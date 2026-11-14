// IngramSpark email parsing — pure functions, no database, no network.
//
// Ingram emails that matter (found by the inbox scan, 2026-11-14):
//   • AR invoices — From AR_Invoices.US@IngramContent.com,
//     Subject "IngramSpark AR Invoice for <account> - <name>".
//     Attachments: invoice.xls + invoice.pdf. Despite the name, invoice.xls is
//     TAB-DELIMITED TEXT (not Excel): one row per invoice line, with the invoice
//     header fields repeated on every row. One email can hold several invoices.
//     These are the author-copy print orders (inventory purchases).
//   • Payment confirmations — From IngramSparkCredit@ingramcontent.com,
//     Subject "IngramSpark Invoice Payment Confirmation". Plain-text body listing
//     the invoices charged to the card on a date. Kept for matching against the
//     credit-card statement later; they don't create transactions.
// Everything else from Ingram (sales rep, newsletters, cover templates) is ignored.

export type IngramEmailKind = "invoice" | "payment_confirmation" | "other";

export function classifyIngramEmail(from: string, subject: string): IngramEmailKind {
  if (/ar_invoices/i.test(from) && /ar invoice/i.test(subject)) return "invoice";
  if (/ingramsparkcredit/i.test(from) && /payment confirmation/i.test(subject)) return "payment_confirmation";
  return "other";
}

export interface InvoiceLine {
  lineNumber: number;
  isbn: string;
  title: string;
  quantity: number;
  listPrice: number;
  unitPrice: number;   // what Ingram charged per copy (before tax/shipping)
  extended: number;    // unitPrice × quantity
  tax: number;
  binding: string | null;
  pageCount: number | null;
  shipDate: string | null;
}

export interface IngramInvoice {
  invoiceNumber: string;
  invoiceDate: string;        // YYYY-MM-DD — the day it was charged/shipped
  salesOrder: string | null;
  salesOrderDate: string | null; // the day she placed the order
  purchaseOrder: string | null;
  customerNumber: string | null;
  terms: string | null;
  currency: string;
  subtotal: number;
  tax: number;
  freight: number;
  handling: number;
  total: number;
  amountDue: number;
  paid: boolean;
  shippingMethod: string | null;
  trackingIds: string[];
  /** Book lines only (the zero-value "Handling Fee" line is dropped). */
  lines: InvoiceLine[];
}

const num = (s: string | undefined) => {
  const n = parseFloat((s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const str = (s: string | undefined) => {
  const t = (s ?? "").trim();
  return t && t !== "N/A" && t !== "NA" ? t : null;
};

/** Parse Ingram's tab-delimited invoice.xls into invoices (grouped by invoice number). */
export function parseInvoiceTsv(text: string): IngramInvoice[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const header = lines[0].split("\t").map((h) => h.trim());
  if (!header.includes("invoice_number") || !header.includes("total_invoice")) {
    throw new Error("invoice.xls doesn't have the expected IngramSpark invoice columns");
  }

  const byNumber = new Map<string, IngramInvoice>();
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    const r: Record<string, string> = {};
    header.forEach((h, i) => (r[h] = cells[i] ?? ""));
    const invoiceNumber = r.invoice_number.trim();
    if (!invoiceNumber) continue;

    let inv = byNumber.get(invoiceNumber);
    if (!inv) {
      inv = {
        invoiceNumber,
        invoiceDate: r.invoice_date.trim(),
        salesOrder: str(r.sales_order),
        salesOrderDate: str(r.sales_order_date),
        purchaseOrder: str(r.purchase_order),
        customerNumber: str(r.customer_number),
        terms: str(r.invoice_terms),
        currency: str(r.currency_code) ?? "USD",
        subtotal: num(r.total_subtotal),
        tax: num(r.total_tax),
        freight: num(r["total_freight/DRM"]),
        handling: num(r.total_handling),
        total: num(r.total_invoice),
        amountDue: num(r.total_amount_due),
        paid: /has been paid/i.test(r.comments ?? "") || num(r.total_amount_due) === 0,
        shippingMethod: str(r.shipping_method),
        trackingIds: [],
        lines: [],
      };
      byNumber.set(invoiceNumber, inv);
    }

    for (const t of (r.tracking_ids ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!inv.trackingIds.includes(t)) inv.trackingIds.push(t);
    }

    const isbn = str(r.isbn_13) ?? str(r.isbn);
    if (!isbn || !/^\d{13}$/.test(isbn)) continue; // "Handling Fee" (DSFUL) and other non-book lines
    inv.lines.push({
      lineNumber: num(r.line_number),
      isbn,
      title: (r.description ?? "").trim(),
      quantity: num(r.quantity_shipped) || num(r.quantity_ordered),
      listPrice: num(r.list_price),
      unitPrice: num(r.selling_price),
      extended: num(r.extended_price),
      tax: num(r.tax_amount),
      binding: str(r.binding_type),
      pageCount: num(r.page_count) || null,
      shipDate: str(r.ship_date),
    });
  }
  return [...byNumber.values()];
}

export interface PaymentConfirmation {
  chargedOn: string;        // YYYY-MM-DD
  cardLast4: string | null;
  total: number;
  currency: string;
  invoices: { invoiceNumber: string; type: string; date: string | null; amount: number }[];
}

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/** "12-SEP-25" or "02-SEP-2025" → "2025-09-12" */
function oracleDate(s: string): string | null {
  const m = /^(\d{1,2})-([A-Z]{3})-(\d{2}|\d{4})$/i.exec(s.trim());
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const month = MONTHS[m[2].toUpperCase()];
  return month ? `${year}-${month}-${m[1].padStart(2, "0")}` : null;
}

/** Parse the plain-text body of an "Invoice Payment Confirmation" email. */
export function parsePaymentConfirmation(text: string): PaymentConfirmation | null {
  const head = /credit card ending in (\d{4}) on (\d{1,2}-[A-Z]{3}-\d{2,4})\.\s*Total charges of ([\d,.]+) ([A-Z]{3})/i.exec(text);
  if (!head) return null;
  const chargedOn = oracleDate(head[2]);
  if (!chargedOn) return null;

  const invoices: PaymentConfirmation["invoices"] = [];
  // Rows look like: "39885572     Inv-SR    Web-Based Short Run Invoices   02-SEP-2025    17.68"
  const row = /^\s*(\d{6,})\s+(\S+)\s+.+?\s+(\d{1,2}-[A-Z]{3}-\d{2,4})\s+([\d,.]+)\s*$/gim;
  for (let m; (m = row.exec(text)); ) {
    invoices.push({ invoiceNumber: m[1], type: m[2], date: oracleDate(m[3]), amount: num(m[4]) });
  }
  return { chargedOn, cardLast4: head[1], total: num(head[3]), currency: head[4].toUpperCase(), invoices };
}

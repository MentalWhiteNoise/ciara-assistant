// 48HR Books email parsing — pure functions, no database, no network.
//
// 48HR Books (48hrbooks.com, Twinsburg OH) emails from info@48hrbooks.com.
// No attachments — everything is in the HTML body. Kinds (from the 2026-11-14
// inbox scan):
//   • confirmation — "Order #N - New Order Confirmation",
//                    "Order #N - New Order Approved Confirmation",
//                    "Order #N - New Exact Reprint Order Confirmation".
//     Hold the order details: binding, pages, quantity ("100 + 25 Free"),
//     Subtotal / Tax / Shipping / Total Cost / Payments / Amount Due.
//     Totals CHANGE over an order's life (extras added after proofs), so the
//     importer uses the latest confirmation that shows it paid in full.
//   • ready        — "48HrBooks.com Order #N" with "ready for pick up" — the
//                    books are done (used as the date stock arrives).
//   • proof / note — proofs awaiting sign-off, order notes and replies. No money.
// The "Book Title" field can be wrong (one order shows a ZIP code instead),
// so a title is only trusted if it isn't just digits; any email of the order
// can supply it.

export type FortyEightEmailKind = "confirmation" | "ready" | "proof" | "note" | "other";

export function is48HrSender(from: string) {
  return /48\s*h(ou)?r\s*books/i.test(from) || /@48hrbooks\.com/i.test(from);
}

export function orderNumberFrom(subject: string): string | null {
  return /order\s*#\s*(\d{5,})/i.exec(subject)?.[1] ?? null;
}

export function classify48HrEmail(from: string, subject: string, text: string): FortyEightEmailKind {
  if (!is48HrSender(from)) return "other";
  if (/^re:/i.test(subject.trim())) return "note"; // conversation replies
  if (/order\b.*\bconfirmation/i.test(subject)) return "confirmation"; // New / New … Approved / Exact Reprint
  if (/proof is awaiting/i.test(subject)) return "proof";
  if (/order note/i.test(subject)) return "note";
  // The "your order is ready" emails are personal ones with a bare subject
  // ("48HrBooks.com Order #208703"); confirmations also mention tracking in
  // their boilerplate, so only the bare subject counts.
  if (/^48\s*hrbooks\.com order #\s*\d+\s*$/i.test(subject.trim()) && /ready for\s+pick\s*-?\s*up|has shipped|on (its|their) way/i.test(text)) {
    return "ready";
  }
  return "other";
}

// HTML → lines lives in gmail/text.ts (shared by every email importer).
export { htmlToLines } from "../gmail/text.js";

export interface FortyEightConfirmation {
  orderNumber: string;
  variant: "new" | "approved" | "reprint";
  title: string | null;       // null when the email's title is junk (e.g. a ZIP code)
  binding: string | null;     // "Case" | "Perfect" | …
  bwPages: number | null;
  colorPages: number | null;
  quantityText: string | null; // as written, e.g. "100 + 25 Free"
  quantity: number;            // total copies incl. free ones
  freeCopies: number;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  payments: number;
  amountDue: number;
  shippingMethod: string | null;
  paidInFull: boolean;
  /** Special finishes — these make a print a special edition. */
  features: { foil: string | null; dustJacket: boolean; edgePrinting: boolean };
}

/** Foil, dust jacket or edge printing ⇒ special edition (owner's rule, 2026-11-14). */
export function isSpecialEdition(c: Pick<FortyEightConfirmation, "features">) {
  return !!c.features.foil || c.features.dustJacket || c.features.edgePrinting;
}

const money = (s: string | undefined) => {
  const n = parseFloat((s ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Value of a "Label" line: the text after "Label:" on the same line, or the next line. */
function field(lines: string[], label: string, from = 0): string | undefined {
  const lower = label.toLowerCase();
  for (let i = from; i < lines.length; i++) {
    const l = lines[i];
    if (l.toLowerCase().startsWith(lower + ":")) return l.slice(label.length + 1).trim() || lines[i + 1];
    if (l.toLowerCase() === lower) return lines[i + 1];
  }
  return undefined;
}

export function cleanTitle(t: string | undefined | null): string | null {
  const s = (t ?? "").trim();
  if (!s || /^\d+$/.test(s)) return null;
  return s;
}

export function parseConfirmation(subject: string, lines: string[]): FortyEightConfirmation | null {
  const orderNumber = field(lines, "Order Number")?.replace(/\D/g, "") || orderNumberFrom(subject);
  if (!orderNumber) return null;
  // Order totals come after the "Book Order Totals" heading; shipping cost there,
  // not the "Shipping" section further down.
  const totalsAt = lines.findIndex((l) => /^book order totals$/i.test(l));
  if (totalsAt < 0) return null;

  const quantityText = field(lines, "Book Quantity") ?? null;
  const q = /(\d[\d,]*)\s*(?:\+\s*(\d[\d,]*)\s*free)?/i.exec(quantityText ?? "");
  const paid = q ? parseInt(q[1].replace(/,/g, ""), 10) : 0;
  const free = q?.[2] ? parseInt(q[2].replace(/,/g, ""), 10) : 0;

  const total = money(field(lines, "Total Cost", totalsAt));
  const amountDue = money(field(lines, "Amount Due", totalsAt));
  const variant = /approved/i.test(subject) ? "approved" : /reprint/i.test(subject) ? "reprint" : "new";
  const pages = (s: string | undefined) => (s && /^\d+$/.test(s) ? parseInt(s, 10) : null);

  return {
    orderNumber,
    variant,
    title: cleanTitle(field(lines, "Book Title")),
    binding: field(lines, "Binding Type") ?? null,
    bwPages: pages(field(lines, "# of B&W Pages")),
    colorPages: pages(field(lines, "# of Color Pages")),
    quantityText,
    quantity: paid + free,
    freeCopies: free,
    subtotal: money(field(lines, "Subtotal", totalsAt)),
    tax: money(field(lines, "Tax", totalsAt)),
    shipping: money(field(lines, "Shipping", totalsAt)),
    total,
    payments: money(field(lines, "Payments", totalsAt)),
    amountDue,
    shippingMethod: field(lines, "Shipping Method") ?? null,
    paidInFull: total > 0 && amountDue === 0,
    features: {
      // "Cover D3D Foil Color: Silver" / "Jacket D3D Foil Color: Gold"
      foil: lines.map((l) => /foil colou?r:\s*(.+)$/i.exec(l)?.[1].trim()).find((x) => x && !/^none$/i.test(x)) ?? null,
      dustJacket: /^yes\b/i.test(field(lines, "Dust Jacket") ?? ""),
      edgePrinting: /^yes\b/i.test(field(lines, "Edge Printing") ?? ""),
    },
  };
}

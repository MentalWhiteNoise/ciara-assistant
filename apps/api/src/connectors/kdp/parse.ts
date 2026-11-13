// KDP report parsing — turns a workbook into typed records.
//
// The report type is detected from the sheets inside the file, so the owner can
// drop any KDP download on the page without saying what it is. Columns are found
// by their header text (not position), so a reordered column won't break imports.

import type { Row, Workbook } from "./xlsx.js";

// ── Output types ──────────────────────────────────────────────────────────────

export type Format = "ebook" | "paperback" | "hardcover" | "audiobook";

export interface ParsedPayment {
  salesPeriod: string; // "2026-08"
  marketplace: string;
  paymentNumber: string;
  paymentDate: string | null;
  paymentMethod: string | null;
  currency: string;
  accruedRoyalty: number | null;
  taxWithholding: number | null;
  netEarnings: number | null;
  fxRate: number | null;
  payoutCurrency: string | null;
  payoutAmount: number | null;
  status: string;
  lines: {
    source: string;
    currency: string;
    accruedRoyalty: number | null;
    taxWithholding: number | null;
    netEarnings: number | null;
  }[];
}

export interface ParsedStatementLine {
  format: Format | "kenp";
  title: string;
  asin: string | null;
  marketplace: string;
  unitsSold: number | null;
  unitsRefunded: number | null;
  netUnits: number | null;
  royaltyType: string | null;
  transactionType: string | null;
  currency: string | null;
  avgListPrice: number | null;
  avgOfferPrice: number | null;
  deliveryCost: number | null;
  earnings: number | null;
}

export interface ParsedDailySale {
  date: string;
  orderDate: string | null;
  format: Format;
  title: string;
  asin: string | null;
  marketplace: string;
  royaltyType: string | null;
  transactionType: string | null;
  unitsSold: number | null;
  unitsRefunded: number | null;
  netUnits: number | null;
  avgListPrice: number | null;
  avgOfferPrice: number | null;
  deliveryCost: number | null;
  royalty: number | null;
  currency: string | null;
}

export interface ParsedDailyKenp {
  date: string;
  title: string;
  asin: string | null;
  marketplace: string;
  pagesRead: number | null;
  pagesListened: number | null;
  totalPages: number | null;
}

export type ParsedReport =
  | { type: "payments"; payments: ParsedPayment[] }
  | {
      type: "statement";
      period: string; // "2026-10"
      lines: ParsedStatementLine[];
      kenpPending: boolean; // KENP earnings still "N/A" → month not finalized yet
    }
  | {
      type: "orders";
      from: string;
      to: string;
      sales: ParsedDailySale[];
      kenp: ParsedDailyKenp[];
    };

// ── Cell helpers ──────────────────────────────────────────────────────────────

export function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const s = v.trim();
  if (s === "" || s.toUpperCase() === "N/A") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function str(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = v.trim();
  return s === "" || s.toUpperCase() === "N/A" ? null : s;
}

// Dates arrive as "2026-10-29" text, but tolerate Excel serial numbers too.
function isoDate(v: string | null | undefined): string | null {
  const s = str(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const serial = Number(s);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    // Excel day 0 = 1899-12-30
    return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
  }
  return null;
}

// Excel stores long payment numbers as numbers ("1.00000109979091E14").
// Write them back out as plain digits.
function paymentNumber(v: string | null): string {
  const s = str(v) ?? "";
  const n = Number(s);
  if (/e/i.test(s) && Number.isSafeInteger(n)) return String(n);
  return s;
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

// "November 2026" → "2026-11"
function monthFromLabel(label: string | null): string | null {
  const m = label?.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const idx = MONTHS.indexOf(m[1].toLowerCase());
  return idx < 0 ? null : `${m[2]}-${String(idx + 1).padStart(2, "0")}`;
}

// Finds columns by header name. `after` handles repeated headers
// (the Payments sheet has two "Currency" columns).
function headerIndex(header: Row) {
  const norm = header.map((h) => (h ?? "").trim().toLowerCase());
  return (name: string, after = -1): number => {
    const target = name.toLowerCase();
    return norm.findIndex((h, i) => i > after && h === target);
  };
}

function requireCols(
  sheet: string,
  col: (name: string, after?: number) => number,
  names: string[]
) {
  const missing = names.filter((n) => col(n) < 0);
  if (missing.length) {
    throw new Error(
      `The "${sheet}" sheet is missing expected column(s): ${missing.join(", ")}. ` +
        `KDP may have changed the report layout.`
    );
  }
}

// IDs listed on a format-specific sheet (eBook Royalty, Paperback Royalty, ...)
function idsOnSheet(book: Workbook, sheet: string, headerRow: number, idHeaders: string[]) {
  const rows = book.get(sheet);
  const ids = new Set<string>();
  if (!rows || rows.length <= headerRow) return ids;
  const col = headerIndex(rows[headerRow]);
  const idx = idHeaders.map((h) => col(h)).find((i) => i >= 0) ?? -1;
  if (idx < 0) return ids;
  for (const r of rows.slice(headerRow + 1)) {
    const id = str(r[idx]);
    if (id) ids.add(id);
  }
  return ids;
}

function formatResolver(book: Workbook, headerRow: number, audioSheet: string) {
  const hardcover = idsOnSheet(book, "Hardcover Royalty", headerRow, ["ISBN"]);
  const paperback = idsOnSheet(book, "Paperback Royalty", headerRow, ["ISBN"]);
  const audio = idsOnSheet(book, audioSheet, headerRow, ["ASIN"]);
  return (id: string | null, transactionType: string | null): Format => {
    const tt = (transactionType ?? "").toLowerCase();
    if ((id && hardcover.has(id)) || tt.includes("hardcover")) return "hardcover";
    if ((id && paperback.has(id)) || tt.includes("paperback")) return "paperback";
    if (id && audio.has(id)) return "audiobook";
    return "ebook";
  };
}

// ── Detection ─────────────────────────────────────────────────────────────────

export function parseKdpReport(book: Workbook): ParsedReport {
  if (book.has("Payments")) return parsePayments(book.get("Payments")!);
  if (book.has("Total Earnings")) return parseStatement(book);
  if (book.has("Combined Sales")) return parseOrders(book);
  throw new Error(
    "This doesn't look like one of the KDP reports Ciara knows (Payments, " +
      "Prior Months' Royalties, or Orders). Sheets found: " +
      [...book.keys()].join(", ")
  );
}

// ── Payments ──────────────────────────────────────────────────────────────────
// Layout: a header row, then for each payout one "summary" row (has a start
// date) followed by one or more detail rows (blank start date, "Source" set).

function parsePayments(rows: Row[]): ParsedReport {
  if (rows.length === 0) throw new Error("The Payments sheet is empty.");
  const col = headerIndex(rows[0]);
  requireCols("Payments", col, [
    "Sales Period - Start Date", "Marketplace", "Payment Number", "Detail", "Date",
    "Currency", "Accrued Royalty", "Tax Withholding", "Net Earnings", "Source",
    "FX Rate", "Payout Amount", "Payment Status",
  ]);
  const c = {
    start: col("Sales Period - Start Date"),
    marketplace: col("Marketplace"),
    number: col("Payment Number"),
    detail: col("Detail"),
    date: col("Date"),
    method: col("Payment Method"),
    currency: col("Currency"),
    accrued: col("Accrued Royalty"),
    withholding: col("Tax Withholding"),
    net: col("Net Earnings"),
    source: col("Source"),
    fx: col("FX Rate"),
    payoutCurrency: col("Currency", col("FX Rate")),
    payout: col("Payout Amount"),
    status: col("Payment Status"),
  };

  const payments: ParsedPayment[] = [];
  let current: ParsedPayment | null = null;

  for (const r of rows.slice(1)) {
    const start = isoDate(r[c.start]);
    if (start) {
      current = {
        salesPeriod: start.slice(0, 7),
        marketplace: str(r[c.marketplace]) ?? "Unknown",
        paymentNumber: paymentNumber(r[c.number]),
        paymentDate: isoDate(r[c.date]),
        paymentMethod: c.method >= 0 ? str(r[c.method]) : null,
        currency: str(r[c.currency]) ?? "USD",
        accruedRoyalty: num(r[c.accrued]),
        taxWithholding: num(r[c.withholding]),
        netEarnings: num(r[c.net]),
        fxRate: num(r[c.fx]),
        payoutCurrency: c.payoutCurrency >= 0 ? str(r[c.payoutCurrency]) : null,
        payoutAmount: num(r[c.payout]),
        status: str(r[c.status]) ?? "Unknown",
        lines: [],
      };
      payments.push(current);
    } else if (current && str(r[c.source])) {
      current.lines.push({
        source: str(r[c.source])!,
        currency: str(r[c.currency]) ?? current.currency,
        accruedRoyalty: num(r[c.accrued]),
        taxWithholding: num(r[c.withholding]),
        netEarnings: num(r[c.net]),
      });
    }
  }

  if (payments.length === 0) throw new Error("No payments found in the Payments report.");
  return { type: "payments", payments };
}

// ── Monthly statement (Prior Months' Royalties) ───────────────────────────────
// Every sheet starts with ["Sales Period", "October 2026"], then a header row.
// "Total Earnings" has every line (sales, free, pre-orders, KENP) in one place.

function parseStatement(book: Workbook): ParsedReport {
  const rows = book.get("Total Earnings")!;
  const period = monthFromLabel(rows[0]?.[1] ?? null);
  if (!period) {
    throw new Error(
      `Couldn't read the statement month (expected e.g. "October 2026" at the top of Total Earnings).`
    );
  }
  const col = headerIndex(rows[1] ?? []);
  requireCols("Total Earnings", col, [
    "Title", "ASIN/ISBN", "Marketplace", "Net Units Sold or Combined KENP",
    "Payout Plan", "Currency", "Earnings",
  ]);
  const deliveryCol = col("Avg. Delivery/Manufacturing cost");
  const formatOf = formatResolver(book, 1, "Audible Royalty");

  const lines: ParsedStatementLine[] = [];
  let kenpPending = false;

  for (const r of rows.slice(2)) {
    const title = str(r[col("Title")]);
    const marketplace = str(r[col("Marketplace")]);
    if (!title || !marketplace) continue;
    const asin = str(r[col("ASIN/ISBN")]);
    const plan = str(r[col("Payout Plan")]);
    const isKenp = (plan ?? "").toUpperCase().includes("KENP");
    const earnings = num(r[col("Earnings")]);
    if (isKenp && earnings === null) kenpPending = true;

    lines.push({
      format: isKenp ? "kenp" : formatOf(asin, plan),
      title,
      asin,
      marketplace,
      unitsSold: num(r[col("Units Sold")]),
      unitsRefunded: num(r[col("Units Refunded")]),
      netUnits: num(r[col("Net Units Sold or Combined KENP")]),
      royaltyType: str(r[col("Royalty Type")]),
      transactionType: plan,
      currency: str(r[col("Currency")]),
      avgListPrice: num(r[col("Avg. List Price without tax")]),
      avgOfferPrice: num(r[col("Avg. Offer Price without tax")]),
      deliveryCost: deliveryCol >= 0 ? num(r[deliveryCol]) : null,
      earnings,
    });
  }

  return { type: "statement", period, lines, kenpPending };
}

// ── Orders / KENP / Dashboard download (all the same workbook) ────────────────

function parseOrders(book: Workbook): ParsedReport {
  const salesRows = book.get("Combined Sales") ?? [];
  const kenpRows = book.get("KENP") ?? [];
  const formatOf = formatResolver(book, 0, "Audiobook Retail Royalty");

  // For long date ranges KDP switches to MONTHLY totals ("2024-01" instead of
  // "2024-01-15"). Those can't be stored as daily rows — and importing them would
  // wipe real daily data in the same range — so refuse them with an explanation.
  // The monthly statements already hold the same month-level numbers.
  const isMonthly = (rows: Row[]) =>
    rows.slice(1).some((r) => /^\d{4}-\d{2}$/.test((r[0] ?? "").trim()));
  if (isMonthly(salesRows) || isMonthly(book.get("Orders Processed") ?? [])) {
    throw new Error(
      "This Orders report covers a long date range, so KDP summarized it by month instead of by day. " +
        "Ciara only imports daily Orders data (monthly numbers come from the statements). " +
        "Download Orders again in pieces of two months or less (e.g. Jan 1 – Feb 28, Mar 1 – Apr 30, ...)."
    );
  }

  // Print sales come from the Paperback/Hardcover sheets when present, because
  // they include the customer's order date. Their totals match the print rows in
  // Combined Sales, so print comes from there and everything else from Combined Sales.
  const printSheets = ["Paperback Royalty", "Hardcover Royalty"]
    .map((name) => ({ name, rows: book.get(name) ?? [] }))
    .filter((s) => s.rows.length > 0 && headerIndex(s.rows[0])("Order Date") >= 0);
  const printFromSheets = printSheets.length === 2;

  const sales: ParsedDailySale[] = [];
  for (const { name, rows } of printFromSheets ? printSheets : []) {
    const col = headerIndex(rows[0]);
    requireCols(name, col, ["Royalty Date", "Order Date", "Title", "ISBN", "Marketplace", "Royalty", "Currency"]);
    for (const r of rows.slice(1)) {
      const date = isoDate(r[col("Royalty Date")]);
      const title = str(r[col("Title")]);
      const marketplace = str(r[col("Marketplace")]);
      if (!date || !title || !marketplace) continue;
      sales.push({
        date,
        orderDate: isoDate(r[col("Order Date")]),
        format: name.startsWith("Hardcover") ? "hardcover" : "paperback",
        title,
        asin: str(r[col("ISBN")]),
        marketplace,
        royaltyType: str(r[col("Royalty Type")]),
        transactionType: str(r[col("Transaction Type")]),
        unitsSold: num(r[col("Units Sold")]),
        unitsRefunded: num(r[col("Units Refunded")]),
        netUnits: num(r[col("Net Units Sold")]),
        avgListPrice: num(r[col("Avg. List Price without tax")]),
        avgOfferPrice: num(r[col("Avg. Offer Price without tax")]),
        deliveryCost: num(r[col("Avg. Manufacturing Cost")]),
        royalty: num(r[col("Royalty")]),
        currency: str(r[col("Currency")]),
      });
    }
  }

  if (salesRows.length > 0) {
    const col = headerIndex(salesRows[0]);
    requireCols("Combined Sales", col, [
      "Royalty Date", "Title", "ASIN/ISBN", "Marketplace", "Royalty", "Currency",
    ]);
    for (const r of salesRows.slice(1)) {
      const date = isoDate(r[col("Royalty Date")]);
      const title = str(r[col("Title")]);
      const marketplace = str(r[col("Marketplace")]);
      if (!date || !title || !marketplace) continue;
      const asin = str(r[col("ASIN/ISBN")]);
      const transactionType = str(r[col("Transaction Type")]);
      const format = formatOf(asin, transactionType);
      const isPrint = format === "paperback" || format === "hardcover";
      if (isPrint && printFromSheets) continue; // already taken from the print sheets
      sales.push({
        date,
        // eBooks: KDP gives no separate order date; the royalty date is the same day.
        orderDate: isPrint ? null : date,
        format,
        title,
        asin,
        marketplace,
        royaltyType: str(r[col("Royalty Type")]),
        transactionType,
        unitsSold: num(r[col("Units Sold")]),
        unitsRefunded: num(r[col("Units Refunded")]),
        netUnits: num(r[col("Net Units Sold")]),
        avgListPrice: num(r[col("Avg. List Price without tax")]),
        avgOfferPrice: num(r[col("Avg. Offer Price without tax")]),
        deliveryCost: num(r[col("Avg. Delivery/Manufacturing cost")]),
        royalty: num(r[col("Royalty")]),
        currency: str(r[col("Currency")]),
      });
    }
  }

  const kenp: ParsedDailyKenp[] = [];
  if (kenpRows.length > 0) {
    const col = headerIndex(kenpRows[0]);
    requireCols("KENP", col, ["Date", "Title", "Marketplace"]);
    for (const r of kenpRows.slice(1)) {
      const date = isoDate(r[col("Date")]);
      const title = str(r[col("Title")]);
      const marketplace = str(r[col("Marketplace")]);
      if (!date || !title || !marketplace) continue;
      kenp.push({
        date,
        title,
        asin: str(r[col("eBook ASIN")]),
        marketplace,
        pagesRead: num(r[col("Kindle+ Pages Read")]),
        pagesListened: num(r[col("Kindle+ Pages Listened")]),
        totalPages: num(r[col("Total Kindle+ Pages Read and Listened")]),
      });
    }
  }

  const dates = [...sales.map((s) => s.date), ...kenp.map((k) => k.date)].sort();
  if (dates.length === 0) {
    throw new Error("This Orders report has no sales or page reads in it — nothing to import.");
  }
  return { type: "orders", from: dates[0], to: dates[dates.length - 1], sales, kenp };
}

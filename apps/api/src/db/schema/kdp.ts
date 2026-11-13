// Amazon KDP report data.
//
// KDP has no API, so the owner downloads three Excel reports and uploads them
// on the KDP Royalties page. Each report lands in its own table(s), kept close
// to KDP's own shape so nothing is lost and re-imports are easy to reason about:
//
//   Payments report      → kdp_payments + kdp_payment_lines   (cash actually paid out)
//   Monthly statement    → kdp_statement_lines                (per-title earnings, incl. KU/KENP)
//   Orders report        → kdp_daily_sales + kdp_daily_kenp   (daily estimates, for trends)
//
// Only PAID payments become rows in `transactions` — that's the money that hits
// the bank, so it is what income reports and taxes are based on. The statement
// and daily tables are for per-book analysis and are never double-counted.
//
// Amounts in these tables are in the marketplace's own currency (GBP, EUR, ...)
// unless the column says USD. Numbers KDP reports as "N/A" are stored as NULL.

import { sqliteTable, text, real, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { transactions } from "./transactions";

// One row per uploaded file — the audit trail behind every KDP number.
export const kdpImports = sqliteTable("kdp_imports", {
  id: text("id").primaryKey(),
  reportType: text("report_type", { enum: ["payments", "statement", "orders"] }).notNull(),
  originalName: text("original_name").notNull(),
  storedName: text("stored_name").notNull(),   // copy kept in data/imports/kdp/
  fileHash: text("file_hash").notNull(),        // SHA-256 — detects re-uploads of the same file
  // Bumped when parsing improves; a re-upload of the same file is re-imported
  // (instead of skipped as a duplicate) if it was parsed by an older version.
  parserVersion: integer("parser_version").notNull().default(1),
  // What the file covers: "2026-10" for a statement, "2026-10-01..2026-11-13" for orders,
  // "2024-01..2026-08" for payments.
  coverage: text("coverage"),
  rowsImported: integer("rows_imported").notNull().default(0),
  transactionsCreated: integer("transactions_created").notNull().default(0),
  warnings: text("warnings"),                   // JSON array of strings
  importedAt: text("imported_at").notNull().default(sql`(datetime('now'))`),
});

// Payments report — one row per payout (per sales month, per marketplace).
export const kdpPayments = sqliteTable(
  "kdp_payments",
  {
    id: text("id").primaryKey(),
    salesPeriod: text("sales_period").notNull(),     // "2026-08" — the month the sales happened
    marketplace: text("marketplace").notNull(),      // "Amazon.co.uk"
    paymentNumber: text("payment_number").notNull(),
    paymentDate: text("payment_date"),               // ISO date the payout was sent
    paymentMethod: text("payment_method"),           // "EFT"
    currency: text("currency").notNull(),            // marketplace currency
    accruedRoyalty: real("accrued_royalty"),
    taxWithholding: real("tax_withholding"),
    netEarnings: real("net_earnings"),
    fxRate: real("fx_rate"),                         // marketplace currency → payout currency
    payoutCurrency: text("payout_currency"),         // usually USD
    payoutAmount: real("payout_amount"),
    status: text("status").notNull(),                // "Paid" | "Failed" | ...
    transactionId: text("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    importId: text("import_id").references(() => kdpImports.id),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("kdp_payments_key").on(t.salesPeriod, t.marketplace, t.paymentNumber),
  ]
);

// The breakdown under each payout: Sales / Paperback Sales / Kindle+ Royalties.
export const kdpPaymentLines = sqliteTable("kdp_payment_lines", {
  id: text("id").primaryKey(),
  paymentId: text("payment_id")
    .notNull()
    .references(() => kdpPayments.id, { onDelete: "cascade" }),
  source: text("source").notNull(),                  // "Sales", "Kindle+ Royalties", ...
  currency: text("currency").notNull(),
  accruedRoyalty: real("accrued_royalty"),
  taxWithholding: real("tax_withholding"),
  netEarnings: real("net_earnings"),
});

// Monthly statement ("Prior Months' Royalties") — taken from its Total Earnings sheet.
// Re-importing a month replaces that month's rows entirely.
export const kdpStatementLines = sqliteTable(
  "kdp_statement_lines",
  {
    id: text("id").primaryKey(),
    period: text("period").notNull(),                // "2026-10"
    format: text("format", {
      enum: ["ebook", "paperback", "hardcover", "audiobook", "kenp"],
    }).notNull(),
    title: text("title").notNull(),
    asin: text("asin"),                              // ASIN or ISBN
    marketplace: text("marketplace").notNull(),
    unitsSold: real("units_sold"),
    unitsRefunded: real("units_refunded"),
    netUnits: real("net_units"),                     // for format=kenp this is KENP pages
    royaltyType: text("royalty_type"),               // "70%", "60%"
    transactionType: text("transaction_type"),       // "Standard", "Free - Promotion", "Pre Order", ...
    currency: text("currency"),
    avgListPrice: real("avg_list_price"),
    avgOfferPrice: real("avg_offer_price"),
    deliveryCost: real("delivery_cost"),             // eBook delivery or print manufacturing cost
    earnings: real("earnings"),                      // NULL for KENP until KDP sets the month's rate
    importId: text("import_id").references(() => kdpImports.id),
  },
  (t) => [index("kdp_statement_period").on(t.period)]
);

// Orders report → daily ESTIMATED royalties. eBook/audiobook rows come from the
// "Combined Sales" sheet; print rows from the Paperback/Hardcover sheets, which
// also carry the customer's order date. Re-importing replaces the file's date range.
//
// `date` is the ROYALTY date (when Amazon processed the sale). `order_date` is
// when the customer ordered: real for print (typically a few days earlier), and
// equal to the royalty date for eBooks (KDP doesn't give a separate one). For
// "what happened around this event?" questions, group by order_date.
export const kdpDailySales = sqliteTable(
  "kdp_daily_sales",
  {
    id: text("id").primaryKey(),
    date: text("date").notNull(),                    // royalty date, ISO
    orderDate: text("order_date"),                   // customer order date (see above)
    format: text("format", { enum: ["ebook", "paperback", "hardcover", "audiobook"] }).notNull(),
    title: text("title").notNull(),
    asin: text("asin"),
    marketplace: text("marketplace").notNull(),
    royaltyType: text("royalty_type"),
    transactionType: text("transaction_type"),
    unitsSold: real("units_sold"),
    unitsRefunded: real("units_refunded"),
    netUnits: real("net_units"),
    avgListPrice: real("avg_list_price"),
    avgOfferPrice: real("avg_offer_price"),
    deliveryCost: real("delivery_cost"),
    royalty: real("royalty"),
    currency: text("currency"),
    importId: text("import_id").references(() => kdpImports.id),
  },
  (t) => [
    index("kdp_daily_sales_date").on(t.date),
    index("kdp_daily_sales_order_date").on(t.orderDate),
  ]
);

// Orders report → "KENP" sheet. Kindle Unlimited pages read per day.
export const kdpDailyKenp = sqliteTable(
  "kdp_daily_kenp",
  {
    id: text("id").primaryKey(),
    date: text("date").notNull(),
    title: text("title").notNull(),
    asin: text("asin"),
    marketplace: text("marketplace").notNull(),
    pagesRead: real("pages_read"),
    pagesListened: real("pages_listened"),
    totalPages: real("total_pages"),
    importId: text("import_id").references(() => kdpImports.id),
  },
  (t) => [index("kdp_daily_kenp_date").on(t.date)]
);

// Generic "this reminder was already created" ledger. Lets the app create a
// recurring reminder exactly once per cycle — and NOT recreate it if the owner
// deletes it. Key examples: "kdp:monthly:2026-10", "kdp:backfill".
export const reminderKeys = sqliteTable("reminder_keys", {
  key: text("key").primaryKey(),
  checklistId: text("checklist_id"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

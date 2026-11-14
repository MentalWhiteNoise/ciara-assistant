// Turns stored IngramSpark invoices (raw records from sync.ts) into Ciara data.
//
//   previewIngramImport() — plans everything, writes NOTHING, returns the plan
//   runIngramImport()     — same plan, written in ONE database transaction
//
// Each invoice is an author-copy print order — an INVENTORY PURCHASE:
//   • one expense transaction for the invoice total (books + sales tax +
//     shipping), category "Book Inventory Purchases" (Schedule C Part III,
//     line 36 "Purchases" — cost of goods sold, not a line-22 supply expense).
//     One transaction per invoice because that's what hits the credit card, so
//     the card statement import can link to it instead of double-counting.
//   • a book product per ISBN (created the first time an ISBN is seen)
//   • a "print_run" inventory movement per title into "home" stock, at the
//     LANDED cost per copy: tax and shipping are spread over the books in
//     proportion to their price, so cost per copy includes getting it here.
//   • the invoice PDF attached to the transaction
//
// import_dedup_log ("ingramspark", "invoice:<number>") guarantees each invoice
// is imported once, however many times its email is seen.

import fs from "node:fs";
import { ulid } from "ulid";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { importDedupLog, importRawRecords, products, transactions } from "../../db/schema/index.js";
import {
  INVENTORY_CATEGORY,
  attachFile,
  bookProductTitle as productTitle,
  ensureInventoryCategoryId,
  findOrCreateBook,
  receiveStock,
} from "../purchases.js";
import { INGRAM_CONNECTOR, dataDir, type InvoiceRawPayload } from "./sync.js";
import type { IngramInvoice } from "./parse.js";

// Ingram binding codes (PF paperback, TC hardcover) → product names like
// "Blackwarden (Hardcover)" — see purchases.ts. The same title can exist in
// several formats, each with its own ISBN.
const PAYEE = "IngramSpark";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export interface PlannedLine {
  isbn: string;
  title: string;
  quantity: number;
  unitPrice: number;
  landedUnitCost: number;
  productExists: boolean;
}

export interface PlannedInvoice {
  invoiceNumber: string;
  invoiceDate: string;
  orderedOn: string | null;
  total: number;
  books: number;
  tax: number;
  shipping: number;
  lines: PlannedLine[];
  hasPdf: boolean;
  warnings: string[];
}

export interface IngramImportSummary {
  toImport: PlannedInvoice[];
  alreadyImported: number;
  newProducts: { isbn: string; title: string }[];
  totals: { invoices: number; amount: number; copies: number };
  byYear: Record<string, { invoices: number; amount: number; copies: number }>;
}

function describe(inv: IngramInvoice) {
  const titles = inv.lines.map((l) => `${l.quantity}× ${productTitle(l.title, l.binding)}`).join(", ");
  return `IngramSpark print order — ${titles || `invoice ${inv.invoiceNumber}`}`;
}

/** Spread tax + shipping + handling over the book lines by their share of the price. */
function landedCosts(inv: IngramInvoice): number[] {
  const booksTotal = inv.lines.reduce((s, l) => s + l.extended, 0);
  const extra = inv.total - booksTotal;
  return inv.lines.map((l) => {
    if (l.quantity <= 0) return 0;
    const share = booksTotal > 0 ? l.extended / booksTotal : 1 / inv.lines.length;
    return round4((l.extended + extra * share) / l.quantity);
  });
}

function plan() {
  const raw = db
    .select({ id: importRawRecords.id, externalId: importRawRecords.externalId, payload: importRawRecords.payload })
    .from(importRawRecords)
    .where(eq(importRawRecords.connector, INGRAM_CONNECTOR))
    .all()
    .filter((r) => r.externalId.startsWith("invoice:"));

  const knownIsbns = new Set(
    db.select({ isbn: products.isbn }).from(products).all().map((p) => p.isbn).filter((x): x is string => !!x)
  );

  const summary: IngramImportSummary = {
    toImport: [], alreadyImported: 0, newProducts: [],
    totals: { invoices: 0, amount: 0, copies: 0 }, byYear: {},
  };
  const planned: { rawId: string; payload: InvoiceRawPayload; landed: number[] }[] = [];

  for (const r of raw) {
    const logged = db.select({ id: importDedupLog.transactionId }).from(importDedupLog)
      .where(and(eq(importDedupLog.connector, INGRAM_CONNECTOR), eq(importDedupLog.externalId, r.externalId))).get();
    if (logged) {
      summary.alreadyImported++;
      continue;
    }
    const payload = JSON.parse(r.payload) as InvoiceRawPayload;
    const inv = payload.invoice;
    const landed = landedCosts(inv);
    const warnings: string[] = [];
    const books = round2(inv.lines.reduce((s, l) => s + l.extended, 0));
    if (Math.abs(round2(inv.subtotal) - books) > 0.01) warnings.push(`book lines add up to ${books}, invoice subtotal says ${inv.subtotal}`);
    if (Math.abs(round2(inv.subtotal + inv.tax + inv.freight + inv.handling) - round2(inv.total)) > 0.01) {
      warnings.push(`subtotal + tax + shipping ≠ total (${inv.total})`);
    }
    if (!inv.paid) warnings.push(`not marked paid — ${inv.amountDue} still due`);
    if (inv.currency !== "USD") warnings.push(`currency is ${inv.currency}`);
    if (inv.lines.length === 0) warnings.push("no book lines — nothing goes into inventory");

    const lines: PlannedLine[] = inv.lines.map((l, i) => {
      const exists = knownIsbns.has(l.isbn);
      if (!exists && !summary.newProducts.some((p) => p.isbn === l.isbn)) summary.newProducts.push({ isbn: l.isbn, title: productTitle(l.title, l.binding) });
      return { isbn: l.isbn, title: l.title, quantity: l.quantity, unitPrice: l.unitPrice, landedUnitCost: landed[i], productExists: exists };
    });

    summary.toImport.push({
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
      orderedOn: inv.salesOrderDate,
      total: inv.total,
      books,
      tax: inv.tax,
      shipping: round2(inv.freight + inv.handling),
      lines,
      hasPdf: !!payload.pdfFile,
      warnings,
    });
    planned.push({ rawId: r.id, payload, landed });

    const copies = inv.lines.reduce((s, l) => s + l.quantity, 0);
    const y = (summary.byYear[inv.invoiceDate.slice(0, 4)] ??= { invoices: 0, amount: 0, copies: 0 });
    y.invoices++;
    y.amount = round2(y.amount + inv.total);
    y.copies += copies;
    summary.totals.invoices++;
    summary.totals.amount = round2(summary.totals.amount + inv.total);
    summary.totals.copies += copies;
  }

  summary.toImport.sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.invoiceNumber.localeCompare(b.invoiceNumber));
  planned.sort((a, b) => a.payload.invoice.invoiceDate.localeCompare(b.payload.invoice.invoiceDate));
  return { summary, planned };
}

export function previewIngramImport(): IngramImportSummary {
  return plan().summary;
}

export function runIngramImport(): IngramImportSummary {
  const { summary, planned } = plan();
  if (planned.length === 0) return summary;
  const now = new Date().toISOString();
  const copiedFiles: string[] = [];

  try {
    db.transaction((tx) => {
      const categoryId = ensureInventoryCategoryId(tx);

      for (const { rawId, payload, landed } of planned) {
        const inv = payload.invoice;
        const transactionId = ulid();
        const notes = [
          `Invoice ${inv.invoiceNumber}` + (inv.salesOrder ? `, order ${inv.salesOrder}` : "") + (inv.salesOrderDate ? ` placed ${inv.salesOrderDate}` : ""),
          `Books ${round2(inv.subtotal).toFixed(2)} + sales tax ${inv.tax.toFixed(2)} + shipping ${round2(inv.freight + inv.handling).toFixed(2)} = ${inv.total.toFixed(2)}`,
          ...inv.lines.map((l, i) => `${l.quantity}× ${l.title} (${l.isbn}) @ ${l.unitPrice.toFixed(2)} — landed ${landed[i].toFixed(2)}/copy`),
          inv.trackingIds.length ? `Tracking (${inv.shippingMethod ?? "UPS"}): ${inv.trackingIds.join(", ")}` : null,
        ].filter(Boolean).join("\n");

        tx.insert(transactions).values({
          id: transactionId,
          type: "expense",
          amount: round2(inv.total),
          currency: inv.currency,
          description: describe(inv),
          categoryId,
          payee: PAYEE,
          paymentMethod: "credit_card",
          referenceId: inv.invoiceNumber,
          source: INGRAM_CONNECTOR,
          notes,
          isTaxDeductible: true,
          taxCategory: INVENTORY_CATEGORY.taxLine,
          occurredAt: inv.invoiceDate,
          reviewStatus: "confirmed",
          counterpartyId: inv.customerNumber ? `ingramspark:${inv.customerNumber}` : null,
          importedAt: now,
        }).run();

        inv.lines.forEach((l, i) => {
          const productId = findOrCreateBook(tx, {
            isbn: l.isbn,
            title: productTitle(l.title, l.binding),
            metadata: { binding: l.binding, pageCount: l.pageCount, listPrice: l.listPrice, createdBy: "ingramspark import" },
          });
          receiveStock(tx, {
            productId,
            quantity: l.quantity,
            unitCost: landed[i],
            transactionId,
            occurredAt: l.shipDate ?? inv.invoiceDate,
            notes: `IngramSpark invoice ${inv.invoiceNumber} @ ${l.unitPrice.toFixed(2)} + tax/shipping`,
          });
        });

        if (payload.pdfFile) {
          const copied = attachFile(tx, {
            dataDir,
            sourceRelPath: payload.pdfFile,
            transactionId,
            fileType: "invoice",
            originalName: `IngramSpark invoice ${inv.invoiceNumber}.pdf`,
            mimeType: "application/pdf",
          });
          if (copied) copiedFiles.push(copied);
        }

        tx.insert(importDedupLog).values({ connector: INGRAM_CONNECTOR, externalId: `invoice:${inv.invoiceNumber}`, transactionId }).run();
        tx.update(importRawRecords).set({ normalizedAt: now }).where(eq(importRawRecords.id, rawId)).run();
      }
    });
  } catch (err) {
    // Database rolled back — remove PDFs copied for rows that no longer exist.
    for (const f of copiedFiles) fs.rmSync(f, { force: true });
    throw err;
  }
  return summary;
}

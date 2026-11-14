// Turns stored 48HR Books emails (raw records from sync.ts) into Ciara data.
//
//   preview48HrImport() — plans everything, writes NOTHING, returns the plan
//   run48HrImport()     — same plan, written in ONE database transaction
//
// Orders are rebuilt from ALL their emails. An order is imported once it has a
// confirmation showing it PAID IN FULL (Amount Due $0.00); the latest such
// confirmation supplies the numbers — totals change while an order is being
// set up (e.g. end sheets added after proofs). Until then it's "waiting".
//
// Each paid order is an inventory purchase (see ../purchases.ts):
//   • one expense, "Book Inventory Purchases", for the order total
//   • the book found or created by title + format. Prints with foil, a dust
//     jacket or edge printing are their own special-edition product, e.g.
//     "Blackwarden (Special Edition Hardcover)"; plain prints match Ingram's
//     ("Title (Paperback)"). 48HR emails have no ISBN.
//   • all copies — INCLUDING the free ones ("100 + 25 Free" = 125) — into home
//     stock at total ÷ copies, dated the "ready for pick up" email if there is one
//   • the final confirmation email attached as the receipt
//
// import_dedup_log ("48hr_books", "order:<number>") guarantees one import per
// order. If a later email shows a different total, it's reported, not changed.

import fs from "node:fs";
import { ulid } from "ulid";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { importDedupLog, importRawRecords, transactions } from "../../db/schema/index.js";
import {
  INVENTORY_CATEGORY,
  attachFile,
  bookProductTitle,
  ensureInventoryCategoryId,
  findBook,
  findOrCreateBook,
  formatFromBinding,
  receiveStock,
} from "../purchases.js";
import { FORTY_EIGHT_CONNECTOR, dataDir, type FortyEightEmailPayload } from "./sync.js";
import { isSpecialEdition, type FortyEightConfirmation } from "./parse.js";

const PAYEE = "48HR Books";

// Every special edition is its own product, so its stock, cost and (later)
// sales stay separate — owner's rule, 2026-11-14. A 48HR print is a special
// edition when it has foil, a dust jacket or edge printing (e.g. Blackwarden
// hardcover with gold-foil jacket; Fated paperback with silver-foil cover).
// Plain prints share the product of the same title + format from IngramSpark.
function productTitleFor48Hr(c: FortyEightConfirmation, title: string) {
  if (!isSpecialEdition(c)) return bookProductTitle(title, c.binding);
  const format = formatFromBinding(c.binding);
  return `${title} (Special Edition${format ? ` ${format}` : ""})`;
}
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Calendar date in 48HR's (and the owner's) time zone — Ohio. */
function localDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(iso));
}

export interface Planned48Order {
  orderNumber: string;
  date: string;              // expense date: day of the paid-in-full confirmation
  receivedOn: string;        // stock date: "ready for pick up" email, else `date`
  title: string;             // product title incl. format
  productExists: boolean;
  quantityText: string;
  copies: number;
  freeCopies: number;
  subtotal: number;
  discount: number;
  tax: number;
  shipping: number;
  total: number;
  unitCost: number;
  emails: number;
  warnings: string[];
}

export interface FortyEightImportSummary {
  toImport: Planned48Order[];
  alreadyImported: number;
  /** Orders seen but not importable yet — e.g. no paid-in-full confirmation. */
  waiting: { orderNumber: string; title: string | null; reason: string; lastTotal: number | null }[];
  /** Imported orders whose newest confirmation shows a different total. */
  changedAfterImport: { orderNumber: string; imported: number; latest: number }[];
  newProducts: string[];
  totals: { orders: number; amount: number; copies: number };
}

interface OrderEmails {
  orderNumber: string;
  emails: { rawId: string; p: FortyEightEmailPayload }[];
}

function loadOrders(): OrderEmails[] {
  const rows = db
    .select({ id: importRawRecords.id, externalId: importRawRecords.externalId, payload: importRawRecords.payload })
    .from(importRawRecords)
    .where(eq(importRawRecords.connector, FORTY_EIGHT_CONNECTOR))
    .all()
    .filter((r) => r.externalId.startsWith("email:"));
  const byOrder = new Map<string, OrderEmails>();
  for (const r of rows) {
    const p = JSON.parse(r.payload) as FortyEightEmailPayload;
    const o = byOrder.get(p.orderNumber) ?? { orderNumber: p.orderNumber, emails: [] };
    o.emails.push({ rawId: r.id, p });
    byOrder.set(p.orderNumber, o);
  }
  for (const o of byOrder.values()) o.emails.sort((a, b) => (a.p.date ?? "").localeCompare(b.p.date ?? ""));
  return [...byOrder.values()].sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));
}

function plan() {
  const summary: FortyEightImportSummary = {
    toImport: [], alreadyImported: 0, waiting: [], changedAfterImport: [], newProducts: [],
    totals: { orders: 0, amount: 0, copies: 0 },
  };
  const planned: { order: OrderEmails; final: FortyEightEmailPayload; plan: Planned48Order; baseTitle: string }[] = [];

  for (const order of loadOrders()) {
    const confirmations = order.emails.filter((e) => e.p.confirmation).map((e) => e.p);
    const latest = confirmations[confirmations.length - 1];
    const final = [...confirmations].reverse().find((c) => c.confirmation!.paidInFull);
    const baseTitle = final?.title ?? [...order.emails].reverse().find((e) => e.p.title)?.p.title ?? null;

    const logged = db.select({ transactionId: importDedupLog.transactionId }).from(importDedupLog)
      .where(and(eq(importDedupLog.connector, FORTY_EIGHT_CONNECTOR), eq(importDedupLog.externalId, `order:${order.orderNumber}`))).get();
    if (logged) {
      summary.alreadyImported++;
      const t = logged.transactionId
        ? db.select({ amount: transactions.amount }).from(transactions).where(eq(transactions.id, logged.transactionId)).get()
        : undefined;
      const latestTotal = latest?.confirmation?.total;
      if (t && latestTotal != null && Math.abs(t.amount - latestTotal) > 0.005) {
        summary.changedAfterImport.push({ orderNumber: order.orderNumber, imported: t.amount, latest: latestTotal });
      }
      continue;
    }

    if (!final) {
      summary.waiting.push({
        orderNumber: order.orderNumber,
        title: baseTitle,
        reason: latest
          ? `latest confirmation (${latest.date?.slice(0, 10)}) still shows $${latest.confirmation!.amountDue.toFixed(2)} due`
          : `no order confirmation email yet (${order.emails.length} other email(s))`,
        lastTotal: latest?.confirmation?.total ?? null,
      });
      continue;
    }
    if (!baseTitle) {
      summary.waiting.push({ orderNumber: order.orderNumber, title: null, reason: "no email in this order gives a believable book title", lastTotal: final.confirmation!.total });
      continue;
    }

    const c = final.confirmation!;
    const warnings: string[] = [];
    const title = productTitleFor48Hr(c, baseTitle);
    if (!formatFromBinding(c.binding)) warnings.push(`unknown binding "${c.binding}" — product named without a format`);
    if (c.quantity <= 0) warnings.push("no copy count — nothing goes into inventory");
    if (latest !== final) warnings.push(`a newer confirmation (${latest.date?.slice(0, 10)}) isn't paid in full — using the paid one`);
    const discount = round2(c.subtotal + c.tax + c.shipping - c.total);
    if (discount < -0.005) warnings.push(`total is ${(-discount).toFixed(2)} MORE than subtotal + tax + shipping`);
    const exists = !!findBook(db, { title });
    if (!exists && !summary.newProducts.includes(title)) summary.newProducts.push(title);

    const ready = order.emails.find((e) => e.p.kind === "ready" && e.p.date);
    const date = localDate(final.date!);
    const p: Planned48Order = {
      orderNumber: order.orderNumber,
      date,
      receivedOn: ready ? localDate(ready.p.date!) : date,
      title,
      productExists: exists,
      quantityText: c.quantityText ?? String(c.quantity),
      copies: c.quantity,
      freeCopies: c.freeCopies,
      subtotal: c.subtotal,
      discount: Math.max(discount, 0),
      tax: c.tax,
      shipping: c.shipping,
      total: c.total,
      unitCost: c.quantity > 0 ? round4(c.total / c.quantity) : 0,
      emails: order.emails.length,
      warnings,
    };
    summary.toImport.push(p);
    planned.push({ order, final, plan: p, baseTitle });
    summary.totals.orders++;
    summary.totals.amount = round2(summary.totals.amount + c.total);
    summary.totals.copies += c.quantity;
  }
  summary.toImport.sort((a, b) => a.date.localeCompare(b.date));
  return { summary, planned };
}

export function preview48HrImport(): FortyEightImportSummary {
  return plan().summary;
}

export function run48HrImport(): FortyEightImportSummary {
  const { summary, planned } = plan();
  if (planned.length === 0) return summary;
  const now = new Date().toISOString();
  const copiedFiles: string[] = [];

  try {
    db.transaction((tx) => {
      const categoryId = ensureInventoryCategoryId(tx);
      for (const { order, final, plan: p, baseTitle } of planned) {
        const c = final.confirmation!;
        const transactionId = ulid();
        const notes = [
          `48HR Books order ${p.orderNumber}: ${p.quantityText} = ${p.copies} copies, ${c.binding ?? "?"} binding, ${c.bwPages ?? "?"} B&W pages`,
          [c.features.foil && `${c.features.foil} foil`, c.features.dustJacket && "dust jacket", c.features.edgePrinting && "edge printing"]
            .filter(Boolean).join(", ") || null,
          `Subtotal ${p.subtotal.toFixed(2)}` + (p.discount > 0 ? ` − discount ${p.discount.toFixed(2)}` : "") +
            ` + tax ${p.tax.toFixed(2)} + shipping ${p.shipping.toFixed(2)} = ${p.total.toFixed(2)}`,
          `Cost per copy (incl. free copies): ${p.unitCost.toFixed(2)}`,
          c.shippingMethod ? `Delivery: ${c.shippingMethod}` + (p.receivedOn !== p.date ? `, ready ${p.receivedOn}` : "") : null,
          `From the ${final.subject.replace(/^.*?- /, "")} of ${p.date} (${order.emails.length} emails for this order)`,
        ].filter(Boolean).join("\n");

        tx.insert(transactions).values({
          id: transactionId,
          type: "expense",
          amount: round2(p.total),
          currency: "USD",
          description: `48HR Books print order #${p.orderNumber} — ${p.copies}× ${p.title}`,
          categoryId,
          payee: PAYEE,
          paymentMethod: "credit_card",
          referenceId: p.orderNumber,
          source: FORTY_EIGHT_CONNECTOR,
          notes,
          isTaxDeductible: true,
          taxCategory: INVENTORY_CATEGORY.taxLine,
          occurredAt: p.date,
          reviewStatus: "confirmed",
          importedAt: now,
        }).run();

        if (p.copies > 0) {
          const productId = findOrCreateBook(tx, {
            title: p.title,
            metadata: { binding: c.binding, pageCount: c.bwPages, specialEdition: isSpecialEdition(c), features: c.features, createdBy: "48hr_books import" },
          });
          receiveStock(tx, {
            productId,
            quantity: p.copies,
            unitCost: p.unitCost,
            transactionId,
            occurredAt: p.receivedOn,
            notes: `48HR Books order ${p.orderNumber} (${p.quantityText}) — ${baseTitle}`,
          });
        }

        const copied = attachFile(tx, {
          dataDir,
          sourceRelPath: final.emlFile,
          transactionId,
          fileType: "receipt",
          originalName: `48HR Books order ${p.orderNumber} confirmation.eml`,
          mimeType: "message/rfc822",
        });
        if (copied) copiedFiles.push(copied);

        tx.insert(importDedupLog).values({ connector: FORTY_EIGHT_CONNECTOR, externalId: `order:${p.orderNumber}`, transactionId }).run();
      }
      // Mark every stored email as processed (re-processing is harmless — dedup guards it).
      tx.update(importRawRecords).set({ normalizedAt: now }).where(eq(importRawRecords.connector, FORTY_EIGHT_CONNECTOR)).run();
    });
  } catch (err) {
    for (const f of copiedFiles) fs.rmSync(f, { force: true });
    throw err;
  }
  return summary;
}

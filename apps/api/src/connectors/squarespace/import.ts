// Turns downloaded Squarespace records into Ciara orders + transactions.
//
//   previewSquarespaceImport() — plans everything, writes NOTHING, returns counts
//   runSquarespaceImport()     — same plan, written in ONE database transaction
//
// Works from the stored raw records only — never calls Squarespace.
// An order is (re)processed when its order or transaction raw record has
// normalized_at = NULL (new, or changed since — e.g. a later refund).
// import_dedup_log (connector "squarespace") guarantees each sale/fee/refund
// is created once, and each PayPal sale is linked once.

import { ulid } from "ulid";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  categories,
  channels,
  importDedupLog,
  importRawRecords,
  orderItems,
  orders,
  transactions,
} from "../../db/schema/index.js";
import { SQUARESPACE_CONNECTOR } from "./sync.js";
import {
  SQ_CHANNEL,
  normalizeSquarespaceOrder,
  num,
  type NormalizedOrder,
  type SqOrder,
  type SqTransaction,
} from "./normalize.js";

const PAYPAL_CONNECTOR = "paypal";

export interface YearBreakdown {
  orders: number;
  gross: number;      // what customers paid
  products: number;   // products after discounts
  shipping: number;
  tax: number;
  refunds: number;
  fees: number;       // processing fees, all processors
  net: number;        // gross − refunds − fees
}

export interface SquarespaceImportSummary {
  ordersToProcess: number;
  ordersNew: number;
  ordersUpdated: number;
  created: { sales: number; fees: number; platformFees: number; refunds: number };
  alreadyImported: number;
  paypalLinks: number;
  deferred: number;
  skipped: Record<string, number>;
  taxFlagged: { orders: number; tax: number };
  /** All Squarespace orders (not just this run), by year — gross vs net. */
  byYear: Record<string, YearBreakdown>;
  byProcessor: Record<string, number>;
}

interface Planned {
  rawIds: string[];
  n: NormalizedOrder;
}

const round = (n: number) => Math.round(n * 100) / 100;

function isLogged(externalId: string, connector = SQUARESPACE_CONNECTOR) {
  return db
    .select({ transactionId: importDedupLog.transactionId })
    .from(importDedupLog)
    .where(and(eq(importDedupLog.connector, connector), eq(importDedupLog.externalId, externalId)))
    .get();
}

function plan() {
  const raw = db
    .select({ id: importRawRecords.id, externalId: importRawRecords.externalId, payload: importRawRecords.payload, normalizedAt: importRawRecords.normalizedAt })
    .from(importRawRecords)
    .where(eq(importRawRecords.connector, SQUARESPACE_CONNECTOR))
    .all();

  const ordersRaw = raw.filter((r) => r.externalId.startsWith("order:"));
  const txnByOrder = new Map<string, { id: string; normalizedAt: string | null; t: SqTransaction }>();
  for (const r of raw) {
    if (!r.externalId.startsWith("transaction:")) continue;
    const t = JSON.parse(r.payload) as SqTransaction;
    if (t.salesOrderId) txnByOrder.set(t.salesOrderId, { id: r.id, normalizedAt: r.normalizedAt, t });
  }

  const paypalSale = (id: string) => {
    const saleId = isLogged(id, PAYPAL_CONNECTOR)?.transactionId;
    if (!saleId) return null;
    const fees = db.select({ amount: transactions.amount }).from(transactions)
      .where(and(eq(transactions.relatedTransactionId, saleId), eq(transactions.type, "expense"))).all();
    return { feeTotal: fees.reduce((s, f) => s + f.amount, 0) };
  };

  const summary: SquarespaceImportSummary = {
    ordersToProcess: 0, ordersNew: 0, ordersUpdated: 0,
    created: { sales: 0, fees: 0, platformFees: 0, refunds: 0 },
    alreadyImported: 0, paypalLinks: 0, deferred: 0, skipped: {},
    taxFlagged: { orders: 0, tax: 0 },
    byYear: {}, byProcessor: {},
  };
  const planned: Planned[] = [];

  for (const r of ordersRaw) {
    const o = JSON.parse(r.payload) as SqOrder;
    const txn = txnByOrder.get(o.id);

    // Gross vs net report over ALL orders, from Squarespace's own numbers.
    if (!o.testmode && txn && !txn.t.voided) {
      const y = (summary.byYear[o.createdOn.slice(0, 4)] ??= { orders: 0, gross: 0, products: 0, shipping: 0, tax: 0, refunds: 0, fees: 0, net: 0 });
      const fees = (txn.t.payments ?? []).flatMap((p) => p.processingFees ?? []).reduce((s, f) => s + num(f.amount), 0);
      y.orders++;
      y.gross += num(o.grandTotal);
      y.products += num(o.subtotal) - num(o.discountTotal);
      y.shipping += num(o.shippingTotal);
      y.tax += num(o.taxTotal);
      y.refunds += num(o.refundedTotal);
      y.fees += fees;
      for (const p of txn.t.payments ?? []) summary.byProcessor[p.provider] = (summary.byProcessor[p.provider] ?? 0) + 1;
    }

    if (r.normalizedAt && (!txn || txn.normalizedAt)) continue; // nothing new
    summary.ordersToProcess++;

    const n = normalizeSquarespaceOrder(o, txn?.t, paypalSale);
    if (n.skipReason) {
      summary.skipped[n.skipReason] = (summary.skipped[n.skipReason] ?? 0) + 1;
      planned.push({ rawIds: [r.id, ...(txn ? [txn.id] : [])], n });
      continue;
    }

    const exists = db.select({ id: orders.id }).from(orders)
      .where(and(eq(orders.source, "squarespace"), eq(orders.externalId, o.id))).get();
    if (exists) summary.ordersUpdated++;
    else summary.ordersNew++;
    if (n.taxFlagged) {
      summary.taxFlagged.orders++;
      summary.taxFlagged.tax += n.order.taxAmount;
    }
    if (n.deferReason) summary.deferred++;

    n.drafts = n.drafts.filter((d) => {
      if (isLogged(d.externalId)) { summary.alreadyImported++; return false; }
      if (d.type === "sale") summary.created.sales++;
      else if (d.type === "refund") summary.created.refunds++;
      else if (d.relatedPayPalId) summary.created.platformFees++;
      else summary.created.fees++;
      return true;
    });
    for (const l of n.paypalLinks) if (!isLogged(`link:${l.paypalTransactionId}`)) summary.paypalLinks++;

    planned.push({ rawIds: [r.id, ...(txn ? [txn.id] : [])], n });
  }

  for (const y of Object.values(summary.byYear)) {
    for (const k of Object.keys(y) as (keyof YearBreakdown)[]) if (k !== "orders") y[k] = round(y[k]);
    y.net = round(y.gross - y.refunds - y.fees);
  }
  summary.taxFlagged.tax = round(summary.taxFlagged.tax);
  return { summary, planned };
}

export function previewSquarespaceImport(): SquarespaceImportSummary {
  return plan().summary;
}

export function runSquarespaceImport(): SquarespaceImportSummary {
  const { summary, planned } = plan();
  const now = new Date().toISOString();
  const categoryIds = new Map(db.select({ id: categories.id, name: categories.name }).from(categories).all().map((c) => [c.name, c.id]));
  const channelIds = new Map(db.select({ id: channels.id, name: channels.name }).from(channels).all().map((c) => [c.name, c.id]));
  const websiteChannelId = channelIds.get(SQ_CHANNEL) ?? null;

  db.transaction((tx) => {
    for (const { rawIds, n } of planned) {
      if (n.skipReason) {
        tx.update(importRawRecords).set({ normalizedAt: now }).where(inArray(importRawRecords.id, rawIds)).run();
        continue;
      }

      // ── Order row (insert or refresh) + its items ──
      const d = n.order;
      const orderValues = {
        orderNumber: d.orderNumber,
        status: d.status,
        customerName: d.customerName,
        customerEmail: d.customerEmail,
        shipToLine1: d.shipTo.line1, shipToLine2: d.shipTo.line2, shipToCity: d.shipTo.city,
        shipToState: d.shipTo.state, shipToZip: d.shipTo.zip, shipToCountry: d.shipTo.country,
        trackingNumber: d.trackingNumber,
        carrier: d.carrier,
        subtotal: d.subtotal,
        shippingCost: d.shippingCost,
        taxAmount: d.taxAmount,
        total: d.total,
        orderedAt: d.orderedAt,
        shippedAt: d.shippedAt,
        updatedAt: now,
      };
      const existing = tx.select({ id: orders.id }).from(orders)
        .where(and(eq(orders.source, "squarespace"), eq(orders.externalId, d.externalId))).get();
      const orderId = existing?.id ?? ulid();
      if (existing) {
        // Leaves internalNote / dueDate / deliveredAt alone — those are Ciara-side.
        tx.update(orders).set(orderValues).where(eq(orders.id, orderId)).run();
        tx.delete(orderItems).where(eq(orderItems.orderId, orderId)).run();
      } else {
        tx.insert(orders).values({
          id: orderId, source: "squarespace", externalId: d.externalId, createdAt: now,
          ...orderValues,
        }).run();
      }
      for (const it of d.items) {
        tx.insert(orderItems).values({ id: ulid(), orderId, title: it.title, quantity: it.quantity, unitPrice: it.unitPrice, variant: it.variant }).run();
      }

      // ── New money rows (Squarespace Payments etc.) ──
      const idByExternal = new Map<string, string>();
      for (const m of n.drafts) {
        const txId = ulid();
        const relatedId = m.relatedPayPalId
          ? isLogged(m.relatedPayPalId, PAYPAL_CONNECTOR)?.transactionId ?? null
          : m.relatedExternalId
          ? idByExternal.get(m.relatedExternalId) ??
            tx.select({ id: importDedupLog.transactionId }).from(importDedupLog)
              .where(and(eq(importDedupLog.connector, SQUARESPACE_CONNECTOR), eq(importDedupLog.externalId, m.relatedExternalId)))
              .get()?.id ?? null
          : null;
        tx.insert(transactions).values({
          id: txId,
          type: m.type,
          amount: m.amount,
          currency: "USD",
          description: m.description,
          categoryId: categoryIds.get(m.categoryName) ?? null,
          channelId: channelIds.get(m.channelName) ?? null,
          payee: m.payee,
          paymentMethod: m.paymentMethod,
          referenceId: m.referenceId,
          source: SQUARESPACE_CONNECTOR,
          notes: m.notes,
          occurredAt: m.occurredAt,
          reviewStatus: "confirmed",
          relatedTransactionId: relatedId,
          orderId,
          importedAt: now, createdAt: now, updatedAt: now,
        }).run();
        tx.insert(importDedupLog).values({ connector: SQUARESPACE_CONNECTOR, externalId: m.externalId, transactionId: txId, importedAt: now }).run();
        idByExternal.set(m.externalId, txId);
      }

      // ── Existing PayPal sales: link to the order, move to website channel ──
      for (const l of n.paypalLinks) {
        const saleId = isLogged(l.paypalTransactionId, PAYPAL_CONNECTOR)?.transactionId;
        if (!saleId) continue;
        // Always keep the order link current; channel/notes only on first link
        // so a later manual change in Ciara isn't overwritten.
        tx.update(transactions).set({ orderId, updatedAt: now })
          .where(eq(transactions.id, saleId)).run();
        tx.update(transactions).set({ orderId, updatedAt: now })
          .where(eq(transactions.relatedTransactionId, saleId)).run();
        if (!isLogged(`link:${l.paypalTransactionId}`)) {
          const sale = tx.select({ notes: transactions.notes }).from(transactions).where(eq(transactions.id, saleId)).get();
          tx.update(transactions)
            .set({ channelId: websiteChannelId, notes: [sale?.notes, l.note].filter(Boolean).join(" · ") })
            .where(eq(transactions.id, saleId)).run();
          // Its PayPal fee/refunds follow it to the website channel.
          tx.update(transactions).set({ channelId: websiteChannelId })
            .where(eq(transactions.relatedTransactionId, saleId)).run();
          tx.insert(importDedupLog).values({ connector: SQUARESPACE_CONNECTOR, externalId: `link:${l.paypalTransactionId}`, transactionId: saleId, importedAt: now }).run();
        }
      }

      // Deferred orders stay unprocessed so the next run retries the PayPal link.
      if (!n.deferReason) {
        tx.update(importRawRecords).set({ normalizedAt: now }).where(inArray(importRawRecords.id, rawIds)).run();
      }
    }
  });

  return summary;
}

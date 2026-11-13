// Turns one Squarespace order (+ its transaction document) into:
//   • an OrderDraft  → a row in Ciara's orders/order_items tables
//   • a money plan   → what to do in the transactions table
//
// Pure functions — no database, no network — so they're unit-testable.
//
// Money rules (agreed 2026-11-13):
//   • Paid by Squarespace Payments (or any non-PayPal processor): the sale is
//     NOT in Ciara yet → create it at GROSS (products + shipping + tax), plus a
//     linked processing-fee expense and one linked refund per refund.
//     Net = gross − fees − refunds; the order row keeps the products/shipping/
//     tax split, and every money row carries order_id so reports can break out
//     gross vs net.
//   • Paid by PayPal: the PayPal importer ALREADY created the sale (and fee and
//     refunds) → create nothing; link the existing sale to the order and move
//     it to the website channel. If the PayPal sale isn't imported yet, defer.
//   • Squarespace's own 3% transaction fee (lower plans; stopped mid-2025) shows
//     up as a second processingFees entry. Squarespace Payments deducts it with
//     the processing fee (one combined fee row). On PayPal-paid orders PayPal
//     never charged it — Squarespace billed it separately — so it's created as
//     its own "Platform Fees" expense linked to the PayPal sale.
//   • Sales tax: kept inside the sale for now (remittance unconfirmed) and
//     flagged in the notes; the order row holds the exact tax amount.

import { localDate } from "../paypal/normalize.js";

// ── Squarespace shapes (only the fields we use) ──────────────────────────────

interface Money { currency: string; value: string | number }

export interface SqOrder {
  id: string;
  orderNumber: string;
  createdOn: string;
  fulfillmentStatus: "PENDING" | "FULFILLED" | "CANCELED" | string;
  fulfilledOn?: string | null;
  testmode?: boolean;
  customerEmail?: string | null;
  billingAddress?: SqAddress | null;
  shippingAddress?: SqAddress | null;
  fulfillments?: { trackingNumber?: string | null; carrierName?: string | null; shipDate?: string | null }[];
  lineItems?: {
    productName?: string | null;
    quantity?: number;
    unitPricePaid?: Money;
    variantOptions?: { optionName?: string; value?: string }[] | null;
  }[];
  discountLines?: { name?: string | null; promoCode?: string | null; amount?: Money }[];
  subtotal: Money;
  shippingTotal: Money;
  discountTotal: Money;
  taxTotal: Money;
  grandTotal: Money;
  refundedTotal: Money;
}

interface SqAddress {
  firstName?: string | null;
  lastName?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
}

export interface SqTransaction {
  id: string;
  salesOrderId?: string | null;
  voided?: boolean;
  payments?: SqPayment[];
}

interface SqPayment {
  id: string;
  amount: Money;
  provider: string; // "SQSP_PAYMENTS" | "PAYPAL" | …
  paidOn: string;
  externalTransactionId?: string | null;
  processingFees?: { amount: Money }[];
  refunds?: { id: string; amount: Money; refundedOn: string }[];
}

// ── Output shapes ────────────────────────────────────────────────────────────

export interface OrderDraft {
  externalId: string;
  orderNumber: string;
  status: "pending" | "shipped" | "cancelled" | "refunded";
  customerName: string;
  customerEmail: string | null;
  shipTo: {
    line1: string | null; line2: string | null; city: string | null;
    state: string | null; zip: string | null; country: string | null;
  };
  trackingNumber: string | null;
  carrier: string | null;
  subtotal: number;      // products, before discounts
  discount: number;
  shippingCost: number;
  taxAmount: number;
  total: number;         // what the customer paid (gross)
  refunded: number;
  orderedAt: string;
  shippedAt: string | null;
  items: { title: string; quantity: number; unitPrice: number; variant: string | null }[];
}

export interface MoneyDraft {
  externalId: string;           // dedup key
  relatedExternalId?: string;   // fee/refund → its sale (Squarespace dedup key)
  relatedPayPalId?: string;     // …or → an existing PayPal sale (PayPal transaction ID)
  type: "sale" | "expense" | "refund";
  amount: number;
  description: string;
  categoryName: string;
  channelName: string;
  paymentMethod: string;
  payee: string | null;
  occurredAt: string;           // YYYY-MM-DD local
  referenceId: string;
  notes: string;
}

export interface PayPalLink {
  paypalTransactionId: string;
  note: string;
}

export interface NormalizedOrder {
  order: OrderDraft;
  /** New rows to create (non-PayPal payments). */
  drafts: MoneyDraft[];
  /** Existing PayPal sales to link to this order. */
  paypalLinks: PayPalLink[];
  /** Set when a PayPal sale isn't in Ciara yet — retry on a later run. */
  deferReason?: string;
  /** Set when the order is ignored entirely (e.g. a test order). */
  skipReason?: string;
  taxFlagged: boolean;
}

export const SQ_CATEGORY = {
  sales: "Sales Income",
  processingFees: "PayPal & Processing Fees",
  platformFees: "Platform Fees",
} as const;
export const SQ_CHANNEL = "Website (Squarespace)";

const PROVIDER_LABEL: Record<string, string> = {
  SQSP_PAYMENTS: "Squarespace Payments",
  PAYPAL: "PayPal",
  STRIPE: "Stripe",
  SQUARE: "Square",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export const num = (m: Money | undefined | null) => {
  const v = Number(m?.value ?? 0);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
};
const usd = (n: number) => `$${n.toFixed(2)}`;
const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

function customerName(o: SqOrder): string {
  for (const a of [o.billingAddress, o.shippingAddress]) {
    const name = [clean(a?.firstName), clean(a?.lastName)].filter(Boolean).join(" ");
    if (name) return name;
  }
  return clean(o.customerEmail) ?? "Squarespace customer";
}

function orderStatus(o: SqOrder): OrderDraft["status"] {
  const total = num(o.grandTotal);
  if (total > 0 && num(o.refundedTotal) >= total - 0.005) return "refunded";
  if (o.fulfillmentStatus === "FULFILLED") return "shipped";
  if (o.fulfillmentStatus === "CANCELED") return "cancelled";
  return "pending";
}

export function toOrderDraft(o: SqOrder): OrderDraft {
  const ship = o.shippingAddress ?? o.billingAddress ?? {};
  const lastShipment = (o.fulfillments ?? []).at(-1);
  return {
    externalId: o.id,
    orderNumber: String(o.orderNumber),
    status: orderStatus(o),
    customerName: customerName(o),
    customerEmail: clean(o.customerEmail),
    shipTo: {
      line1: clean(ship.address1), line2: clean(ship.address2), city: clean(ship.city),
      state: clean(ship.state), zip: clean(ship.postalCode), country: clean(ship.countryCode),
    },
    trackingNumber: clean(lastShipment?.trackingNumber),
    carrier: clean(lastShipment?.carrierName),
    subtotal: num(o.subtotal),
    discount: num(o.discountTotal),
    shippingCost: num(o.shippingTotal),
    taxAmount: num(o.taxTotal),
    total: num(o.grandTotal),
    refunded: num(o.refundedTotal),
    orderedAt: o.createdOn,
    shippedAt: o.fulfilledOn ?? clean(lastShipment?.shipDate) ?? null,
    items: (o.lineItems ?? []).map((li) => ({
      title: clean(li.productName) ?? "Item",
      quantity: li.quantity ?? 1,
      unitPrice: num(li.unitPricePaid),
      variant:
        (li.variantOptions ?? [])
          .map((v) => [v.optionName, v.value].filter(Boolean).join(": "))
          .filter(Boolean)
          .join(", ") || null,
    })),
  };
}

/** "Products $40.00 · Discount −$5.00 · Shipping $6.50 · Tax $2.80" */
function breakdownNote(d: OrderDraft): string {
  return [
    `Products ${usd(d.subtotal)}`,
    d.discount > 0 ? `Discount −${usd(d.discount)}` : null,
    `Shipping ${usd(d.shippingCost)}`,
    d.taxAmount > 0 ? `Tax ${usd(d.taxAmount)}` : null,
  ].filter(Boolean).join(" · ");
}

export const TAX_FLAG = "⚠ Sales tax collected — remittance not yet confirmed";

// ── Main ─────────────────────────────────────────────────────────────────────

/**
 * @param paypalSale  looks up a PayPal transaction ID in Ciara: null if the
 *                    PayPal importer hasn't created it yet, else the total of
 *                    the PayPal fees already recorded against it.
 */
export function normalizeSquarespaceOrder(
  o: SqOrder,
  t: SqTransaction | undefined,
  paypalSale: (paypalTransactionId: string) => { feeTotal: number } | null
): NormalizedOrder {
  const order = toOrderDraft(o);
  const result: NormalizedOrder = { order, drafts: [], paypalLinks: [], taxFlagged: order.taxAmount > 0 };

  if (o.testmode) return { ...result, skipReason: "test order" };
  if (!t || t.voided) return result; // order only (e.g. free / not charged / voided)

  const first = order.items[0]?.title ?? "order";
  const more = order.items.length > 1 ? ` (+${order.items.length - 1} more)` : "";
  const description = `Squarespace #${order.orderNumber} — ${first}${more}`;
  const breakdown = breakdownNote(order);

  for (const p of t.payments ?? []) {
    const provider = PROVIDER_LABEL[p.provider] ?? p.provider;

    if (p.provider === "PAYPAL") {
      const ppId = clean(p.externalTransactionId);
      if (!ppId) continue;
      const sale = paypalSale(ppId);
      if (!sale) {
        result.deferReason = "PayPal sale not imported yet";
        continue;
      }
      result.paypalLinks.push({
        paypalTransactionId: ppId,
        note: [`Squarespace order #${order.orderNumber}`, breakdown, result.taxFlagged ? TAX_FLAG : null]
          .filter(Boolean).join(" · "),
      });
      // Squarespace's fees beyond what PayPal deducted = Squarespace's own
      // transaction fee, billed separately.
      const sqFees = (p.processingFees ?? []).reduce((s, f) => s + num(f.amount), 0);
      const platformFee = Math.round((sqFees - sale.feeTotal) * 100) / 100;
      if (platformFee >= 0.01) {
        result.drafts.push({
          externalId: `${t.id}:${p.id}:platform-fee`,
          relatedPayPalId: ppId,
          type: "expense",
          amount: platformFee,
          description: `Squarespace transaction fee — #${order.orderNumber}`,
          categoryName: SQ_CATEGORY.platformFees,
          channelName: SQ_CHANNEL,
          paymentMethod: "Squarespace",
          payee: "Squarespace",
          occurredAt: localDate(p.paidOn),
          referenceId: `#${order.orderNumber}`,
          notes: "Squarespace plan transaction fee on a PayPal-paid order. PayPal didn't deduct it; Squarespace billed it separately (may also appear on a card statement)",
        });
      }
      continue; // PayPal importer owns this sale's processing fee and refunds
    }

    const saleId = `${t.id}:${p.id}:sale`;
    const date = localDate(p.paidOn);
    const amount = num(p.amount);
    if (amount <= 0) continue;

    result.drafts.push({
      externalId: saleId,
      type: "sale",
      amount,
      description,
      categoryName: SQ_CATEGORY.sales,
      channelName: SQ_CHANNEL,
      paymentMethod: provider,
      payee: order.customerName,
      occurredAt: date,
      referenceId: `#${order.orderNumber}`,
      notes: [breakdown, result.taxFlagged ? TAX_FLAG : null, p.externalTransactionId ? `${provider} ID ${p.externalTransactionId}` : null]
        .filter(Boolean).join(" · "),
    });

    const fee = Math.round((p.processingFees ?? []).reduce((s, f) => s + num(f.amount), 0) * 100) / 100;
    if (fee > 0) {
      result.drafts.push({
        externalId: `${t.id}:${p.id}:fee`,
        relatedExternalId: saleId,
        type: "expense",
        amount: fee,
        description: `${provider} fee — #${order.orderNumber}`,
        categoryName: SQ_CATEGORY.processingFees,
        channelName: SQ_CHANNEL,
        paymentMethod: provider,
        payee: provider,
        occurredAt: date,
        referenceId: `#${order.orderNumber}`,
        notes: (p.processingFees ?? []).length > 1
          ? `Processing fee on ${usd(amount)}, incl. Squarespace's 3% transaction fee`
          : `Processing fee on ${usd(amount)}`,
      });
    }

    for (const r of p.refunds ?? []) {
      const ra = num(r.amount);
      if (ra <= 0) continue;
      result.drafts.push({
        externalId: `refund:${r.id}`,
        relatedExternalId: saleId,
        type: "refund",
        amount: ra,
        description: `Refund — Squarespace #${order.orderNumber}`,
        categoryName: SQ_CATEGORY.sales,
        channelName: SQ_CHANNEL,
        paymentMethod: provider,
        payee: order.customerName,
        occurredAt: localDate(r.refundedOn),
        referenceId: `#${order.orderNumber}`,
        notes: ra < amount - 0.005 ? `Partial refund of ${usd(amount)}` : "Full refund",
      });
    }
  }
  return result;
}

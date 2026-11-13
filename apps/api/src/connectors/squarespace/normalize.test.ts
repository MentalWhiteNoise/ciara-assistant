// Squarespace normalizer tests — synthetic fixtures only (no real customer data).
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSquarespaceOrder, TAX_FLAG, type SqOrder, type SqTransaction } from "./normalize.js";

const $ = (value: number) => ({ currency: "USD", value: value.toFixed(2) });

function order(over: Partial<SqOrder> = {}): SqOrder {
  return {
    id: "o1", orderNumber: "1001", createdOn: "2025-05-01T15:00:00Z",
    fulfillmentStatus: "FULFILLED", fulfilledOn: "2025-05-03T15:00:00Z", testmode: false,
    customerEmail: "buyer@example.com",
    billingAddress: { firstName: "Pat", lastName: "Example", city: "Town", state: "OR", postalCode: "97000", countryCode: "US" },
    lineItems: [{ productName: "Book One", quantity: 1, unitPricePaid: $(20), variantOptions: [{ optionName: "Edition", value: "Signed" }] }],
    subtotal: $(20), discountTotal: $(0), shippingTotal: $(5), taxTotal: $(0), grandTotal: $(25), refundedTotal: $(0),
    ...over,
  };
}

function txn(provider: string, over: Partial<NonNullable<SqTransaction["payments"]>[number]> = {}): SqTransaction {
  return {
    id: "t1", salesOrderId: "o1", voided: false,
    payments: [{ id: "p1", amount: $(25), provider, paidOn: "2025-05-01T15:00:05Z", externalTransactionId: "EXT1",
      processingFees: [{ amount: $(0.75) }, { amount: $(0.30) }], refunds: [], ...over }],
  };
}

const never = () => null;

test("Squarespace Payments order → gross sale + summed fee, both on the website channel", () => {
  const n = normalizeSquarespaceOrder(order(), txn("SQSP_PAYMENTS"), never);
  assert.equal(n.drafts.length, 2);
  const [sale, fee] = n.drafts;
  assert.equal(sale.type, "sale");
  assert.equal(sale.amount, 25); // products + shipping (gross)
  assert.equal(sale.channelName, "Website (Squarespace)");
  assert.equal(sale.paymentMethod, "Squarespace Payments");
  assert.match(sale.notes, /Products \$20\.00 · Shipping \$5\.00/);
  assert.equal(fee.type, "expense");
  assert.equal(fee.amount, 1.05);
  assert.equal(fee.relatedExternalId, sale.externalId);
  assert.equal(n.order.status, "shipped");
  assert.equal(n.order.items[0].variant, "Edition: Signed");
});

test("sales tax stays in the gross sale and is flagged", () => {
  const n = normalizeSquarespaceOrder(order({ taxTotal: $(1.6), grandTotal: $(26.6) }), txn("SQSP_PAYMENTS", { amount: $(26.6) }), never);
  assert.equal(n.taxFlagged, true);
  assert.equal(n.drafts[0].amount, 26.6);
  assert.ok(n.drafts[0].notes.includes(TAX_FLAG));
  assert.equal(n.order.taxAmount, 1.6);
});

test("refunds become linked refund rows; full refund marks the order refunded", () => {
  const n = normalizeSquarespaceOrder(
    order({ refundedTotal: $(25) }),
    txn("SQSP_PAYMENTS", { refunds: [{ id: "r1", amount: $(25), refundedOn: "2025-05-10T15:00:00Z" }] }),
    never
  );
  const refund = n.drafts.find((d) => d.type === "refund")!;
  assert.equal(refund.amount, 25);
  assert.equal(refund.externalId, "refund:r1");
  assert.equal(refund.relatedExternalId, n.drafts[0].externalId);
  assert.equal(n.order.status, "refunded");
});

test("partial refund is noted and the order keeps its shipping status", () => {
  const n = normalizeSquarespaceOrder(
    order({ refundedTotal: $(5) }),
    txn("SQSP_PAYMENTS", { refunds: [{ id: "r2", amount: $(5), refundedOn: "2025-05-10T15:00:00Z" }] }),
    never
  );
  assert.match(n.drafts.find((d) => d.type === "refund")!.notes, /Partial refund/);
  assert.equal(n.order.status, "shipped");
});

test("PayPal-paid order creates NO money rows — links the existing PayPal sale", () => {
  const n = normalizeSquarespaceOrder(order(), txn("PAYPAL", { externalTransactionId: "PP123" }), (id) => (id === "PP123" ? { feeTotal: 1.05 } : null));
  assert.equal(n.drafts.length, 0);
  assert.deepEqual(n.paypalLinks.map((l) => l.paypalTransactionId), ["PP123"]);
  assert.equal(n.deferReason, undefined);
});

test("PayPal-paid order whose PayPal sale isn't imported yet is deferred, not duplicated", () => {
  const n = normalizeSquarespaceOrder(order(), txn("PAYPAL", { externalTransactionId: "PP999" }), never);
  assert.equal(n.drafts.length, 0);
  assert.equal(n.paypalLinks.length, 0);
  assert.ok(n.deferReason);
});

test("test orders are skipped; unshipped orders are pending; no transaction → order only", () => {
  assert.ok(normalizeSquarespaceOrder(order({ testmode: true }), txn("SQSP_PAYMENTS"), never).skipReason);
  const pending = normalizeSquarespaceOrder(order({ fulfillmentStatus: "PENDING", fulfilledOn: null }), undefined, never);
  assert.equal(pending.order.status, "pending");
  assert.equal(pending.drafts.length, 0);
});

test("PayPal-paid order: Squarespace's extra 3% fee becomes a Platform Fees expense on the PayPal sale", () => {
  const n = normalizeSquarespaceOrder(
    order(),
    txn("PAYPAL", { externalTransactionId: "PP7", processingFees: [{ amount: $(0.75) }, { amount: $(1.15) }] }),
    () => ({ feeTotal: 1.15 }) // PayPal deducted 1.15 itself
  );
  assert.equal(n.drafts.length, 1);
  assert.equal(n.drafts[0].categoryName, "Platform Fees");
  assert.equal(n.drafts[0].amount, 0.75);
  assert.equal(n.drafts[0].relatedPayPalId, "PP7");
});

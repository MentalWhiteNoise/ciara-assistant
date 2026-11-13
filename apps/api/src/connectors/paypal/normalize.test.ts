// Unit tests for the PayPal normalizer. Fixtures are made-up records shaped
// like real Transaction Search output (no real customer data).
// Run: pnpm test   (uses Node's built-in test runner — no extra library)

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContext, normalizePayPal, CATEGORY, CHANNEL, type PayPalRecord } from "./normalize.js";

let seq = 0;
function rec(code: string, value: string, extra: Partial<PayPalRecord["transaction_info"]> = {}, rest: Partial<PayPalRecord> = {}): PayPalRecord {
  return {
    transaction_info: {
      transaction_id: extra.transaction_id ?? `TX${++seq}`,
      transaction_event_code: code,
      transaction_initiation_date: "2026-03-14T18:30:00+0000",
      transaction_amount: { currency_code: "USD", value },
      transaction_status: "S",
      ...extra,
    },
    ...rest,
  };
}

function drafts(r: PayPalRecord, all: PayPalRecord[] = [r]) {
  const res = normalizePayPal(r, buildContext(all));
  assert.equal(res.kind, "drafts", `expected drafts, got ${JSON.stringify(res)}`);
  return (res as Extract<typeof res, { kind: "drafts" }>).drafts;
}

test("POS sale → confirmed sale at full amount + linked fee expense", () => {
  const r = rec("T0018", "25.00", { fee_amount: { currency_code: "USD", value: "-1.12" } }, {
    cart_info: { item_details: [{ item_name: "Signed paperback", item_quantity: "2" }] },
  });
  const [sale, fee] = drafts(r);
  assert.equal(sale.type, "sale");
  assert.equal(sale.amount, 25);
  assert.equal(sale.reviewStatus, "confirmed");
  assert.equal(sale.categoryName, CATEGORY.eventSales);
  assert.equal(sale.channelName, CHANNEL.pos);
  assert.equal(sale.description, "Signed paperback ×2");
  assert.equal(fee.type, "expense");
  assert.equal(fee.amount, 1.12);
  assert.equal(fee.categoryName, CATEGORY.processingFees);
  assert.equal(fee.externalId, `${r.transaction_info.transaction_id}:fee`);
  assert.equal(fee.relatedExternalId, r.transaction_info.transaction_id);
});

test("checkout sale with a partner fee is a website sale; partner fee links to it", () => {
  const sale = rec("T0006", "40.00", { fee_amount: { currency_code: "USD", value: "-1.50" } });
  const partner = rec("T0113", "-1.20", { paypal_reference_id: sale.transaction_info.transaction_id });
  const all = [sale, partner];
  assert.equal(drafts(sale, all)[0].channelName, CHANNEL.website);
  const [pf] = drafts(partner, all);
  assert.equal(pf.type, "expense");
  assert.equal(pf.categoryName, CATEGORY.platformFees);
  assert.equal(pf.reviewStatus, "confirmed");
  assert.equal(pf.relatedExternalId, sale.transaction_info.transaction_id);
});

test("PayPal invoice payment goes to the invoice channel", () => {
  const r = rec("T0006", "100.00", {}, { cart_info: { paypal_invoice_id: "INV2-XXXX" } });
  assert.equal(drafts(r)[0].channelName, CHANNEL.invoice);
});

test("outgoing payments are expenses that need review, with counterparty for rules", () => {
  const r = rec("T0003", "-12.99", {}, {
    payer_info: { account_id: "MERCHANT1", payer_name: { alternate_full_name: "Some Software Co" } },
  });
  const [d] = drafts(r);
  assert.equal(d.type, "expense");
  assert.equal(d.amount, 12.99);
  assert.equal(d.reviewStatus, "needs_review");
  assert.equal(d.payee, "Some Software Co");
  assert.equal(d.counterpartyId, "MERCHANT1");
});

test("general payment received needs review (could be personal)", () => {
  assert.equal(drafts(rec("T0000", "50.00"))[0].reviewStatus, "needs_review");
});

test("bank funding and withdrawals are transfers", () => {
  const purchase = rec("T0003", "-30.00");
  const funding = rec("T0300", "30.00", { paypal_reference_id: purchase.transaction_info.transaction_id });
  const [f] = drafts(funding, [purchase, funding]);
  assert.equal(f.type, "transfer");
  assert.equal(f.relatedExternalId, purchase.transaction_info.transaction_id);
  assert.equal(drafts(rec("T0403", "-200.00"))[0].type, "transfer");
});

test("refund to a customer is a confirmed refund; refund received needs review", () => {
  const out = drafts(rec("T1107", "-15.00", { paypal_reference_id: "ORIG" }))[0];
  assert.equal(out.type, "refund");
  assert.equal(out.reviewStatus, "confirmed");
  assert.equal(out.relatedExternalId, "ORIG");
  assert.equal(drafts(rec("T1107", "15.00"))[0].reviewStatus, "needs_review");
});

test("holds, releases and conversions are skipped — even when pending", () => {
  for (const code of ["T1501", "T1105", "T0200"]) {
    const res = normalizePayPal(rec(code, "-5.00", { transaction_status: "P" }), buildContext([]));
    assert.equal(res.kind, "skip", code);
  }
});

test("pending payments are deferred; denied/reversed are skipped", () => {
  assert.equal(normalizePayPal(rec("T0006", "10.00", { transaction_status: "P" }), buildContext([])).kind, "defer");
  assert.equal(normalizePayPal(rec("T0006", "10.00", { transaction_status: "D" }), buildContext([])).kind, "skip");
  assert.equal(normalizePayPal(rec("T0006", "10.00", { transaction_status: "V" }), buildContext([])).kind, "skip");
});

test("foreign-currency payment uses PayPal's USD conversion, fee converted at same rate", () => {
  const sale = rec("T0006", "20.00", { fee_amount: { currency_code: "GBP", value: "-1.00" } });
  sale.transaction_info.transaction_amount.currency_code = "GBP";
  const id = sale.transaction_info.transaction_id;
  const convGbp = rec("T0200", "-20.00", { paypal_reference_id: id });
  convGbp.transaction_info.transaction_amount.currency_code = "GBP";
  const convUsd = rec("T0200", "25.00", { paypal_reference_id: id });
  const [s, fee] = drafts(sale, [sale, convGbp, convUsd]);
  assert.equal(s.currency, "USD");
  assert.equal(s.amount, 25);
  assert.match(s.notes ?? "", /Originally 20\.00 GBP/);
  assert.equal(fee.amount, 1.25);
});

test("foreign currency without a conversion keeps its currency and needs review", () => {
  const r = rec("T0006", "20.00");
  r.transaction_info.transaction_amount.currency_code = "EUR";
  const [d] = drafts(r);
  assert.equal(d.currency, "EUR");
  assert.equal(d.reviewStatus, "needs_review");
});

test("unknown event codes are imported by sign and flagged for review", () => {
  const [d] = drafts(rec("T9999", "-3.00"));
  assert.equal(d.type, "expense");
  assert.equal(d.reviewStatus, "needs_review");
  assert.match(d.notes ?? "", /Unrecognized/);
});

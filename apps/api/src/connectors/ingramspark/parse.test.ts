import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIngramEmail, parseInvoiceTsv, parsePaymentConfirmation } from "./parse.js";

// Made-up data in the same shape as Ingram's tab-delimited invoice.xls.
const header = [
  "invoice_number", "invoice_date", "sales_order", "sales_order_date", "customer_number", "comments",
  "total_subtotal", "total_tax", "total_freight/DRM", "total_handling", "total_invoice", "total_amount_due",
  "currency_code", "line_number", "isbn", "isbn_13", "description", "quantity_ordered", "quantity_shipped",
  "list_price", "selling_price", "tax_amount", "extended_price", "tracking_ids", "ship_date", "shipping_method",
];
const row = (o: Record<string, string>) => header.map((h) => o[h] ?? "").join("\t");
const base = {
  invoice_date: "2026-01-05", sales_order: "111", sales_order_date: "2026-01-01", customer_number: "999",
  comments: "*** THIS INVOICE HAS BEEN PAID ***", currency_code: "USD", total_amount_due: "0",
  ship_date: "2026-01-05", shipping_method: "UPS Ground Residential",
};

test("parses invoices, groups rows, drops the handling-fee line", () => {
  const tsv = [
    header.join("\t"),
    row({ ...base, invoice_number: "A1", total_subtotal: "100", total_tax: "8", "total_freight/DRM": "12", total_handling: "0", total_invoice: "120",
      line_number: "1", isbn: "9780000000001", isbn_13: "9780000000001", description: "Book One", quantity_ordered: "10", quantity_shipped: "10",
      list_price: "20", selling_price: "10", tax_amount: "8", extended_price: "100", tracking_ids: "1Z1, 1Z2" }),
    row({ ...base, invoice_number: "A1", total_subtotal: "100", total_tax: "8", "total_freight/DRM": "12", total_handling: "0", total_invoice: "120",
      line_number: "2", isbn: "N/A", isbn_13: "DSFUL", description: "Handling Fee", quantity_shipped: "1", extended_price: "0" }),
    row({ ...base, invoice_number: "A2", total_subtotal: "50", total_tax: "0", "total_freight/DRM": "0", total_handling: "0", total_invoice: "50",
      line_number: "1", isbn: "9780000000002", isbn_13: "9780000000002", description: "Book Two", quantity_shipped: "5",
      selling_price: "10", extended_price: "50" }),
  ].join("\r\n");

  const invoices = parseInvoiceTsv(tsv);
  assert.equal(invoices.length, 2);
  const a1 = invoices[0];
  assert.equal(a1.invoiceNumber, "A1");
  assert.equal(a1.total, 120);
  assert.equal(a1.freight, 12);
  assert.equal(a1.paid, true);
  assert.deepEqual(a1.trackingIds, ["1Z1", "1Z2"]);
  assert.equal(a1.lines.length, 1);
  assert.equal(a1.lines[0].quantity, 10);
  assert.equal(a1.lines[0].unitPrice, 10);
  assert.equal(invoices[1].lines[0].title, "Book Two");
});

test("rejects a file without invoice columns", () => {
  assert.throws(() => parseInvoiceTsv("a\tb\n1\t2\n"));
});

test("parses a payment confirmation", () => {
  const text = `Someone (999)
The following open invoices were charged against your credit card ending in 1234 on 12-SEP-25. Total charges of 17.68 USD will be listed under the name of "IngramSpark" on your credit card statement.
Invoice      Type            Description                    Date                 Amount
------------ --------------- ------------------------------ ----------- ---------------
39885572     Inv-SR          Web-Based Short Run Invoices   02-SEP-2025           17.68
Thank you for your business.`;
  const p = parsePaymentConfirmation(text);
  assert.ok(p);
  assert.equal(p.chargedOn, "2025-09-12");
  assert.equal(p.cardLast4, "1234");
  assert.equal(p.total, 17.68);
  assert.deepEqual(p.invoices, [{ invoiceNumber: "39885572", type: "Inv-SR", date: "2025-09-02", amount: 17.68 }]);
});

test("classifies Ingram emails", () => {
  assert.equal(classifyIngramEmail("<AR_Invoices.US@IngramContent.com>", "IngramSpark AR Invoice for 1 - X"), "invoice");
  assert.equal(classifyIngramEmail("<IngramSparkCredit@ingramcontent.com>", "IngramSpark Invoice Payment Confirmation"), "payment_confirmation");
  assert.equal(classifyIngramEmail("Sales Rep <rep@ingramcontent.com>", "Hello from your rep"), "other");
});

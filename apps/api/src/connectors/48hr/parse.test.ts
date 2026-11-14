import { test } from "node:test";
import assert from "node:assert/strict";
import { classify48HrEmail, htmlToLines, isSpecialEdition, orderNumberFrom, parseConfirmation } from "./parse.js";

const FROM = '"48HrBooks.com" <info@48hrbooks.com>';

// Made-up order in the shape of a 48HR confirmation email (HTML table layout).
const confirmationHtml = (o: { title: string; qty: string; subtotal: string; total: string; payments: string; due: string; foil?: string }) => `
<html><body><style>.x{color:red}</style>
<p>Thank you for ordering from 48 Hour Books!</p>
<p>Order Number: 123456</p><p>Book Title: ${o.title}</p>
<table><tr><td>Binding Type</td><td>Case</td></tr>
<tr><td># of B&amp;W Pages</td><td>300</td></tr>
<tr><td>Book Quantity</td><td>${o.qty}</td></tr>
<tr><td>Edge Printing</td><td>No</td></tr>
${o.foil ? `<tr><td>Cover D3D Foil Color: ${o.foil}</td></tr>` : ""}</table>
<h3>Book Order Totals</h3>
<table><tr><td>Subtotal</td><td>&#36;${o.subtotal}</td></tr>
<tr><td>Tax</td><td>$0.00</td></tr><tr><td>Shipping</td><td>$0.00</td></tr>
<tr><td>Total Cost</td><td>$${o.total}</td></tr>
<tr><td>Payments</td><td>$${o.payments}</td></tr>
<tr><td>Amount Due</td><td>$${o.due}</td></tr></table>
<h3>Shipping</h3><table><tr><td>Shipping Method</td><td>Pick-Up: Twinsburg</td></tr>
<tr><td>Book Quantity</td><td>999</td></tr></table>
</body></html>`;

test("classifies 48HR emails by subject", () => {
  assert.equal(classify48HrEmail(FROM, "48HrBooks.com Order #1 - New Order Confirmation", ""), "confirmation");
  assert.equal(classify48HrEmail(FROM, "48HrBooks.com Order #1 - New Order Approved Confirmation", ""), "confirmation");
  assert.equal(classify48HrEmail(FROM, "48HrBooks.com Order #1 - New Exact Reprint Order Confirmation", "UPS tracking #"), "confirmation");
  assert.equal(classify48HrEmail(FROM, "48HrBooks.com Order #1 - Your PDF Proof is Awaiting Signoff!", ""), "proof");
  assert.equal(classify48HrEmail(FROM, "48HrBooks.com - An order note for order #1 has been generated online", ""), "note");
  assert.equal(classify48HrEmail(FROM, "48HrBooks.com Order #208703", "order 208703 will be ready for\npick up this afternoon"), "ready");
  assert.equal(classify48HrEmail(FROM, "RE: 48HrBooks.com Order #211429", "ready for pick up"), "note");
  assert.equal(classify48HrEmail("someone@example.com", "48HrBooks.com Order #1 - New Order Confirmation", ""), "other");
  assert.equal(orderNumberFrom("48HrBooks.com - An order note reply for order #208703 has been generated online"), "208703");
});

test("parses a paid-in-full confirmation, counting free copies", () => {
  const html = confirmationHtml({ title: "My Book", qty: "100 + 25 Free", subtotal: "1,020.00", total: "1,000.00", payments: "1,000.00", due: "0.00", foil: "Silver" });
  const c = parseConfirmation("48HrBooks.com Order #123456 - New Exact Reprint Order Confirmation", htmlToLines(html));
  assert.ok(c);
  assert.equal(c.orderNumber, "123456");
  assert.equal(c.variant, "reprint");
  assert.equal(c.title, "My Book");
  assert.equal(c.binding, "Case");
  assert.equal(c.bwPages, 300);
  assert.equal(c.quantity, 125);  // from the first "Book Quantity", not the shipping section
  assert.equal(c.freeCopies, 25);
  assert.equal(c.subtotal, 1020);
  assert.equal(c.total, 1000);
  assert.equal(c.paidInFull, true);
  assert.equal(c.shippingMethod, "Pick-Up: Twinsburg");
  assert.deepEqual(c.features, { foil: "Silver", dustJacket: false, edgePrinting: false });
  assert.equal(isSpecialEdition(c), true);
});

test("a part-paid confirmation is not paid in full; a ZIP-code title is ignored", () => {
  const html = confirmationHtml({ title: "90210", qty: "50", subtotal: "500.00", total: "500.00", payments: "100.00", due: "400.00" });
  const c = parseConfirmation("48HrBooks.com Order #123456 - New Order Confirmation", htmlToLines(html));
  assert.ok(c);
  assert.equal(c.title, null);
  assert.equal(c.quantity, 50);
  assert.equal(c.freeCopies, 0);
  assert.equal(c.amountDue, 400);
  assert.equal(c.paidInFull, false);
  assert.equal(isSpecialEdition(c), false); // no foil, no jacket, edge printing "No"
});

test("a dust jacket alone (no foil) makes it a special edition", () => {
  const html = `<p>Order Number: 123456</p><p>Book Title: My Book</p>
<table><tr><td>Binding Type</td><td>Case</td></tr><tr><td>Book Quantity</td><td>10</td></tr>
<tr><td>Edge Printing</td><td>Yes</td></tr><tr><td>Dust Jacket</td><td>Yes </td></tr></table>
<h3>Book Order Totals</h3><table><tr><td>Total Cost</td><td>$100.00</td></tr><tr><td>Amount Due</td><td>$0.00</td></tr></table>`;
  const c = parseConfirmation("48HrBooks.com Order #123456 - New Order Approved Confirmation", htmlToLines(html));
  assert.ok(c);
  assert.deepEqual(c.features, { foil: null, dustJacket: true, edgePrinting: true });
  assert.equal(isSpecialEdition(c), true);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyWiseEmail, parseTransferSent, transferNumberFrom } from "./parse.js";

const FROM = '"Wise" <noreply@wise.com>';

test("classifies Wise emails", () => {
  assert.equal(classifyWiseEmail(FROM, "Transfer sent (#1234567890)"), "transfer_sent");
  assert.equal(classifyWiseEmail(FROM, "There’s a problem with your transfer (#1234567890)"), "transfer_problem");
  assert.equal(classifyWiseEmail("Wise <noreply@info.wise.com>", "Top tips to help you get more for your money"), "other");
  assert.equal(classifyWiseEmail("someone@example.com", "Transfer sent (#1234567890)"), "other");
  assert.equal(transferNumberFrom("Transfer sent (#1234567890)"), "1234567890");
});

test("parses the older layout (values on their own lines)", () => {
  const text = `Hello Ciara,
212.50 USD is now in Jane Q Artist's account.
Transfer details
Amount:
212.50 USD
Wise fee:
0 USD
Transfer Number:
#1234567890`;
  assert.deepEqual(parseTransferSent("Transfer sent (#1234567890)", text), {
    transferNumber: "1234567890", recipient: "Jane Q Artist", amount: 212.5, currency: "USD", fee: 0, feeCurrency: "USD",
  });
});

test("parses the newer ALL-CAPS layout and tidies the name", () => {
  const text = `Hello Ciara,
1,072.50 USD IS NOW IN SOME ARTIST'S ACCOUNT.
TRANSFER DETAILS
Amount: 1,072.50 USD Wise fee: 3.25 USD Transfer Number: #2234567890`;
  const t = parseTransferSent("Transfer sent (#2234567890)", text);
  assert.ok(t);
  assert.equal(t.recipient, "Some Artist");
  assert.equal(t.amount, 1072.5);
  assert.equal(t.fee, 3.25);
});

test("returns null when the body doesn't say who was paid", () => {
  assert.equal(parseTransferSent("Transfer sent (#1234567890)", "Hello"), null);
});

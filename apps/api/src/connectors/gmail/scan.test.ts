import { test } from "node:test";
import assert from "node:assert/strict";
import { SCAN_SERVICES } from "./scan.js";

// Sender formats as they actually appear in the reports inbox.
test("scan sender rules match each service's real senders, and not others", () => {
  const cases: [keyof typeof SCAN_SERVICES, string, boolean][] = [
    ["wise", '"Wise" <noreply@wise.com>', true],
    ["wise", "<news@info.transferwise.com>", true],
    ["wise", '"Otherwise Shop" <hello@otherwise.co>', false],
    ["ingramspark", "<AR_Invoices.US@IngramContent.com>", true],
    ["48hr_books", '"48HrBooks.com" <info@48hrbooks.com>', true],
    ["48hr_books", "<AR_Invoices.US@IngramContent.com>", false],
  ];
  for (const [service, from, expected] of cases) {
    assert.equal(SCAN_SERVICES[service].sender.test(from), expected, `${service}: ${from}`);
  }
});

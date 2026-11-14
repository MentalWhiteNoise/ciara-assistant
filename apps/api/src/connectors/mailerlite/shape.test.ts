// Pure helper tests — no network, no vault, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mlDate, signupMonths, trimCampaign } from "./shape.js";

test("mlDate reads MailerLite's zone-less dates as UTC", () => {
  assert.equal(mlDate("2022-07-26 15:07:52"), "2022-07-26T15:07:52.000Z");
  assert.equal(mlDate(null), null);
  assert.equal(mlDate("garbage"), null);
});

test("signupMonths walks back whole calendar months, newest first", () => {
  const m = signupMonths(new Date("2026-03-15T12:00:00Z"), 3);
  assert.deepEqual(m, [
    ["2026-03", "2026-03-01", "2026-03-31"],
    ["2026-02", "2026-02-01", "2026-02-28"],
    ["2026-01", "2026-01-01", "2026-01-31"],
  ]);
});

test("trimCampaign keeps stats and subjects, drops email text and sender", () => {
  const t = trimCampaign({
    id: "1", name: "Launch", status: "sent", finished_at: "2026-01-01 10:00:00",
    stats: { sent: 500 }, filter: [{ x: 1 }],
    emails: [{ id: "e1", subject: "New book!", from: "me@example.com", plain_text: "long text", stats: { sent: 500 } }],
  });
  assert.deepEqual(t.emails, [{ id: "e1", subject: "New book!", stats: { sent: 500 } }]);
  assert.equal(JSON.stringify(t).includes("plain_text"), false);
  assert.equal(JSON.stringify(t).includes("me@example.com"), false);
  assert.equal("filter" in t, false);
});

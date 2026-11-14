// Allowlist tests — pure, no network, no vault, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { __test, EndpointNotAllowedError } from "./client.js";

const { assertAllowed } = __test;

test("allows the read-only list endpoints", () => {
  for (const p of ["/api/groups", "/api/campaigns", "/api/automations"]) {
    assert.doesNotThrow(() => assertAllowed("GET", p, { page: "1" }));
  }
});

test("allows subscriber COUNTS (limit=0) with count filters", () => {
  assert.doesNotThrow(() => assertAllowed("GET", "/api/subscribers", { limit: "0" }));
  assert.doesNotThrow(() =>
    assertAllowed("GET", "/api/subscribers", {
      limit: "0",
      "filter[status]": "active",
      "filter[subscribed_from]": "2026-10-01",
      "filter[subscribed_to]": "2026-10-31",
    })
  );
});

test("refuses listing subscribers (anything but limit=0)", () => {
  for (const q of [{}, { limit: "1" }, { limit: "1000" }, { limit: "0", cursor: "x" }, { limit: "0", with_fields: "1" }, { limit: "0", include: "groups" }]) {
    assert.throws(() => assertAllowed("GET", "/api/subscribers", q as Record<string, string>), EndpointNotAllowedError, JSON.stringify(q));
  }
});

test("refuses any non-GET method, even on allowed paths", () => {
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.throws(() => assertAllowed(m, "/api/campaigns"), EndpointNotAllowedError);
    assert.throws(() => assertAllowed(m, "/api/subscribers", { limit: "0" }), EndpointNotAllowedError);
  }
});

test("refuses single records, sub-resources and unlisted paths", () => {
  for (const p of [
    "/api/subscribers/123",
    "/api/subscribers/a@b.com",
    "/api/subscribers/123/activity-log",
    "/api/groups/1/subscribers",
    "/api/campaigns/1/schedule",
    "/api/campaigns/1/reports/subscriber-activity",
    "/api/automations/1/activity",
    "/api/campaigns/../subscribers",
    "/api/webhooks",
    "/api/batch",
  ]) assert.throws(() => assertAllowed("GET", p), EndpointNotAllowedError, p);
});

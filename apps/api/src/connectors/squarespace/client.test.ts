// Allowlist tests — pure, no network, no vault, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { __test, EndpointNotAllowedError } from "./client.js";

const { assertAllowed } = __test;

test("allows the read-only list endpoints", () => {
  for (const p of [
    "/1.0/authorization/website",
    "/1.0/commerce/orders",
    "/1.0/commerce/transactions",
    "/v2/commerce/products",
  ]) assert.doesNotThrow(() => assertAllowed("GET", p));
});

test("refuses any non-GET method, even on allowed paths", () => {
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.throws(() => assertAllowed(m, "/1.0/commerce/orders"), EndpointNotAllowedError);
  }
});

test("refuses write-ish and unlisted paths", () => {
  for (const p of [
    "/1.0/commerce/orders/abc/fulfillments",
    "/1.0/commerce/inventory/adjustments",
    "/v2/commerce/products/abc",
    "/1.0/commerce/orders?x=1",
    "/1.0/commerce/orders/../../webhook_subscriptions",
    "/1.0/webhook_subscriptions",
  ]) assert.throws(() => assertAllowed("GET", p), EndpointNotAllowedError, p);
});

test("nextPageUrl must stay on api.squarespace.com and an allowlisted path", async () => {
  const { getNextPage } = __test;
  // Both are rejected before any key is loaded or any request is made.
  await assert.rejects(() => getNextPage("https://evil.example.com/1.0/commerce/orders?cursor=x"), EndpointNotAllowedError);
  await assert.rejects(() => getNextPage("https://api.squarespace.com/1.0/webhook_subscriptions?cursor=x"), EndpointNotAllowedError);
});

// PayPal REST client — READ-ONLY by construction.
//
// Security model (see memory/plan + docs/SECURITY.md):
//   • PayPal has no "read-only app" type, and Live apps force some payment
//     features on. So the guarantee that Ciara can never move money lives HERE:
//     every request goes through `request()`, which refuses anything not on
//     ALLOWED_ENDPOINTS. There is deliberately no generic "call any URL" method.
//   • Credentials come from the vault at call time and never leave this module.
//   • The OAuth access token lives in memory only (never disk, never logged).
//   • Error messages include PayPal's error name/message/debug_id only — never
//     request headers, tokens, or the client secret.
//
// How PayPal auth works ("client credentials" OAuth flow):
//   POST /v1/oauth2/token with HTTP Basic auth (clientId:clientSecret)
//   → { access_token, expires_in (seconds, ~9h), scope: "url url url ..." }
//   Then every API call sends "Authorization: Bearer <access_token>".
//   `scope` lists which features the app was granted — we surface it so the
//   user can see exactly what the Live app is allowed to do.

import { getSecret } from "../../vault/vault.js";

export type PayPalEnvironment = "sandbox" | "live";

const BASE_URLS: Record<PayPalEnvironment, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

/** The ONLY requests this client can make. Anything else throws before any
 *  network traffic happens. Keep this list read-only (GET) apart from the
 *  token exchange, which is how OAuth works and moves no money. */
const ALLOWED_ENDPOINTS: { method: "GET" | "POST"; path: RegExp }[] = [
  { method: "POST", path: /^\/v1\/oauth2\/token$/ },
  { method: "GET", path: /^\/v1\/reporting\/transactions$/ },
  { method: "GET", path: /^\/v1\/reporting\/balances$/ },
];

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

export class PayPalError extends Error {
  constructor(
    message: string,
    public status: number,
    /** PayPal's error code, e.g. "invalid_client", "NOT_AUTHORIZED". */
    public code?: string,
    /** PayPal support reference — safe to show/log. */
    public debugId?: string
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

export class EndpointNotAllowedError extends Error {
  constructor(method: string, path: string) {
    super(`PayPal client refused ${method} ${path}: not on the read-only allowlist`);
    this.name = "EndpointNotAllowedError";
  }
}

interface PayPalCredentials {
  environment: PayPalEnvironment;
  clientId: string;
  clientSecret: string;
  /** Changes whenever credentials are re-saved; used to invalidate the token cache. */
  savedAt: string;
}

function loadCredentials(): PayPalCredentials {
  const entry = getSecret("paypal"); // throws VaultLockedError if locked
  if (!entry) throw new PayPalError("PayPal credentials are not saved", 400, "not_configured");
  const c = entry.credentials;
  const environment = c.environment === "live" ? "live" : "sandbox";
  if (typeof c.clientId !== "string" || typeof c.clientSecret !== "string") {
    throw new PayPalError("PayPal credentials are incomplete", 400, "not_configured");
  }
  return { environment, clientId: c.clientId, clientSecret: c.clientSecret, savedAt: entry.updatedAt };
}

/** Sandbox and Live data are stored under different connector names so test
 *  records never mix with real ones (raw records, sync jobs, dedup). */
export function getPayPalConnectorKey(): "paypal" | "paypal_sandbox" {
  return loadCredentials().environment === "live" ? "paypal" : "paypal_sandbox";
}

// ── Token cache (memory only) ─────────────────────────────────────────────────

interface CachedToken {
  cacheKey: string;
  accessToken: string;
  expiresAt: number; // epoch ms
  scopes: string[];
}
let cachedToken: CachedToken | null = null;

/** Forget the cached access token (e.g. when the vault locks). */
export function clearPayPalToken() {
  cachedToken = null;
}

// ── Core request function ─────────────────────────────────────────────────────

function assertAllowed(method: string, path: string) {
  const ok = ALLOWED_ENDPOINTS.some((e) => e.method === method && e.path.test(path));
  if (!ok) throw new EndpointNotAllowedError(method, path);
}

async function request(
  creds: PayPalCredentials,
  method: "GET" | "POST",
  path: string,
  opts: { query?: Record<string, string>; headers: Record<string, string>; body?: string }
): Promise<unknown> {
  // Check BEFORE building the URL so a path like "/v1/payments?x=/v1/reporting"
  // can't sneak through — the regexes are anchored on the bare path.
  assertAllowed(method, path);

  const url = new URL(path, BASE_URLS[creds.environment]);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { Accept: "application/json", ...opts.headers },
      body: opts.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error", // never follow a redirect to some other endpoint
    });

    // Rate limited: wait (honouring Retry-After if given) and try again.
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 2000;
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 60_000)));
      continue;
    }

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }

    if (!res.ok) throw toPayPalError(res.status, json);
    return json;
  }
}

/** Build a safe error from PayPal's response body. Two shapes exist:
 *  OAuth:  { error, error_description }
 *  REST:   { name, message, debug_id, details: [{ issue, description }] } */
function toPayPalError(status: number, body: unknown): PayPalError {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.error === "string") {
    return new PayPalError(String(b.error_description ?? b.error), status, b.error);
  }
  const detail = Array.isArray(b.details) ? (b.details[0] as Record<string, unknown> | undefined) : undefined;
  const message =
    (detail?.description as string | undefined) ??
    (b.message as string | undefined) ??
    `PayPal returned HTTP ${status}`;
  return new PayPalError(
    message,
    status,
    (b.name as string | undefined) ?? (detail?.issue as string | undefined),
    b.debug_id as string | undefined
  );
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getToken(creds: PayPalCredentials): Promise<CachedToken> {
  const cacheKey = `${creds.environment}:${creds.clientId}:${creds.savedAt}`;
  // Reuse the token until 5 minutes before it expires.
  if (cachedToken && cachedToken.cacheKey === cacheKey && cachedToken.expiresAt - 5 * 60_000 > Date.now()) {
    return cachedToken;
  }

  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const res = (await request(creds, "POST", "/v1/oauth2/token", {
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  })) as { access_token: string; expires_in: number; scope?: string };

  cachedToken = {
    cacheKey,
    accessToken: res.access_token,
    expiresAt: Date.now() + res.expires_in * 1000,
    scopes: (res.scope ?? "").split(" ").filter(Boolean).sort(),
  };
  return cachedToken;
}

async function authedGet(path: string, query: Record<string, string>): Promise<unknown> {
  const creds = loadCredentials();
  const token = await getToken(creds);
  try {
    return await request(creds, "GET", path, {
      query,
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
  } catch (err) {
    // Token revoked/expired early → drop it so the next call fetches a new one.
    if (err instanceof PayPalError && err.status === 401) clearPayPalToken();
    throw err;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Which environment the saved credentials point at, plus the scopes PayPal
 *  granted the app. Fetches a token if needed. */
export async function getPayPalGrant() {
  const creds = loadCredentials();
  const token = await getToken(creds);
  return { environment: creds.environment, scopes: token.scopes };
}

/** PayPal timestamps look like 2024-01-31T23:59:59-0000 (no colon in offset). */
export function toPayPalDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "-0000");
}

export interface TransactionSearchParams {
  start: Date;
  end: Date; // must be ≤ 31 days after start
  page?: number;
  pageSize?: number; // max 500
}

/** One page of GET /v1/reporting/transactions. Raw PayPal shape — the
 *  normalizer (later step) turns these into Ciara transactions. */
export async function searchTransactions(p: TransactionSearchParams) {
  return (await authedGet("/v1/reporting/transactions", {
    start_date: toPayPalDate(p.start),
    end_date: toPayPalDate(p.end),
    fields: "all",
    page_size: String(p.pageSize ?? 500),
    page: String(p.page ?? 1),
  })) as {
    transaction_details: unknown[];
    total_items: number;
    total_pages: number;
    page: number;
    last_refreshed_datetime?: string;
  };
}

/** Exported for unit tests of the allowlist. */
export const __test = { assertAllowed };

// Squarespace Commerce API client — READ-ONLY by construction.
//
// How Squarespace auth works: the site owner generates an API key
// (Settings → Advanced → Developer API Keys) and picks a permission level per
// API. Every request sends "Authorization: Bearer <key>". There is no token
// exchange — the key itself is the credential, so it is read from the vault at
// call time and never stored anywhere else, never logged, never returned.
//
// Same guarantee as the PayPal client: every request goes through
// `request()`, which only allows GET and only the paths on ALLOWED_ENDPOINTS.
// Even if the key were accidentally created with "Read and Write", this code
// cannot create, change, or refund anything.
//
// Squarespace docs: https://developers.squarespace.com/commerce-apis/overview
//   • base URL https://api.squarespace.com, JSON only
//   • a User-Agent header is REQUIRED (generic app name — nothing personal)
//   • 300 requests/minute; over that → HTTP 429 and a 1-minute cool-down
//   • lists return ≤50 items per page plus { pagination: { hasNextPage, nextPageCursor } }

import { getSecret } from "../../vault/vault.js";

const BASE_URL = "https://api.squarespace.com";
const USER_AGENT = "CiaraAssistant/0.1 (personal bookkeeping; read-only)";

/** The ONLY requests this client can make — all GET. */
const ALLOWED_ENDPOINTS: RegExp[] = [
  /^\/1\.0\/authorization\/website$/,
  /^\/1\.0\/commerce\/orders$/,
  /^\/1\.0\/commerce\/transactions$/,
  /^\/v2\/commerce\/products$/,
];

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
// Stay well under 300/min (5/s): at most ~3 requests per second.
const MIN_GAP_MS = 350;

export class SquarespaceError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Squarespace's error `type`, e.g. "AUTHORIZATION_ERROR". */
    public code?: string,
    /** Squarespace support reference — safe to show/log. */
    public contextId?: string
  ) {
    super(message);
    this.name = "SquarespaceError";
  }
}

export class EndpointNotAllowedError extends Error {
  constructor(method: string, path: string) {
    super(`Squarespace client refused ${method} ${path}: not on the read-only allowlist`);
    this.name = "EndpointNotAllowedError";
  }
}

function loadApiKey(): string {
  const entry = getSecret("squarespace"); // throws VaultLockedError if locked
  const key = entry?.credentials.apiKey;
  if (typeof key !== "string" || !key.trim()) {
    throw new SquarespaceError("Squarespace API key is not saved", 400, "not_configured");
  }
  return key.trim();
}

function assertAllowed(method: string, path: string) {
  if (method !== "GET" || !ALLOWED_ENDPOINTS.some((re) => re.test(path))) {
    throw new EndpointNotAllowedError(method, path);
  }
}

let lastRequestAt = 0;

async function get(path: string, query: Record<string, string> = {}): Promise<unknown> {
  // Check the bare path BEFORE building the URL (anchored regexes).
  assertAllowed("GET", path);
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return fetchJson(url);
}

/** Follow a `pagination.nextPageUrl` exactly as Squarespace returned it.
 *  (Re-encoding the bare cursor ourselves produced "Invalid cursor".)
 *  The URL must still point at api.squarespace.com and an allowlisted path. */
async function getNextPage(nextPageUrl: string): Promise<unknown> {
  const url = new URL(nextPageUrl, BASE_URL);
  if (url.origin !== BASE_URL) throw new EndpointNotAllowedError("GET", url.origin + url.pathname);
  assertAllowed("GET", url.pathname);
  return fetchJson(url);
}

async function fetchJson(url: URL): Promise<unknown> {
  const apiKey = loadApiKey();

  for (let attempt = 0; ; attempt++) {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
    });

    // 429 = rate limited (Squarespace says cool down for a minute).
    // 5xx = their side; docs recommend retrying with backoff.
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const waitMs = res.status === 429 ? 60_000 : 2 ** attempt * 2000;
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) throw toSquarespaceError(res.status, json);
    return json;
  }
}

/** Squarespace error body: { type, subtype, message, details, contextId }. */
function toSquarespaceError(status: number, body: unknown): SquarespaceError {
  const b = (body ?? {}) as Record<string, unknown>;
  const fallback: Record<number, string> = {
    401: "Squarespace rejected the API key (missing, wrong, or revoked)",
    402: "The Squarespace site's subscription has expired",
    403: "This API key doesn't have permission for that",
  };
  const message = (typeof b.message === "string" && b.message) || fallback[status] || `Squarespace returned HTTP ${status}`;
  return new SquarespaceError(
    message,
    status,
    typeof b.type === "string" ? b.type : undefined,
    typeof b.contextId === "string" ? b.contextId : undefined
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface Pagination {
  hasNextPage: boolean;
  nextPageCursor: string | null;
  nextPageUrl: string | null;
}

export interface WebsiteInfo {
  id: string;
  title: string;
  url: string;
  currency: string;
  timeZone: string;
}

export async function getWebsite(): Promise<WebsiteInfo> {
  return (await get("/1.0/authorization/website")) as WebsiteInfo;
}

/** Optional "modified between" filter. Squarespace requires both ends together. */
export interface ModifiedRange {
  after: Date;
  before: Date;
}

/** First page: build the query. Later pages: follow nextPageUrl as given
 *  (it already carries the cursor and remembers the original filters). */
function listPage(path: string, opts: ListOpts, extra: Record<string, string> = {}) {
  if (opts.nextPageUrl) return getNextPage(opts.nextPageUrl);
  return get(path, listQuery(opts.range, extra));
}

export interface ListOpts {
  /** pagination.nextPageUrl from the previous page; omit for the first page. */
  nextPageUrl?: string;
  range?: ModifiedRange;
}

function listQuery(range: ModifiedRange | undefined, extra: Record<string, string> = {}) {
  const q: Record<string, string> = { ...extra };
  if (range) {
    q.modifiedAfter = range.after.toISOString();
    q.modifiedBefore = range.before.toISOString();
  }
  return q;
}

export async function listOrders(opts: ListOpts) {
  // No paymentStates filter: with it, Squarespace rejected page 2 as "Invalid
  // cursor". The default (NOT_CHARGED, AUTHORIZED, PAID, REFUNDED) covers every
  // order that moved money; failed/pending ones are left out.
  return (await listPage("/1.0/commerce/orders", opts)) as { result: Record<string, unknown>[]; pagination: Pagination };
}

export async function listTransactions(opts: ListOpts) {
  return (await listPage("/1.0/commerce/transactions", opts)) as {
    documents: Record<string, unknown>[];
    pagination: Pagination;
  };
}

export async function listProducts(opts: ListOpts) {
  return (await listPage("/v2/commerce/products", opts)) as {
    products: Record<string, unknown>[];
    pagination: Pagination;
  };
}

/** Exported for unit tests of the allowlist. */
export const __test = { assertAllowed, getNextPage };

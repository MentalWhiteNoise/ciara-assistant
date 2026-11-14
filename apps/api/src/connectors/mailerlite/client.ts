// MailerLite API client — READ-ONLY and COUNTS-ONLY by construction.
//
// How MailerLite auth works: the account owner generates an API token
// (Integrations → MailerLite API) and every request sends
// "Authorization: Bearer <token>". MailerLite tokens can't be limited to
// read-only, so a token CAN send campaigns or delete subscribers. The limits
// therefore live here, in code:
//
//   1. Only GET, and only the paths on ALLOWED_ENDPOINTS.
//   2. The subscribers endpoint may ONLY be called with limit=0, which makes
//      MailerLite return a bare count ({ "total": N }) and no subscriber data.
//      Ciara never downloads anyone's email address or name.
//
// Docs: https://developers.mailerlite.com/docs/
//   • base URL https://connect.mailerlite.com/api, JSON only
//   • 120 requests/minute; over that → HTTP 429 with a Retry-After header
//   • campaigns/groups/automations are page-based: { data, meta: { current_page, last_page, total } }

import { getSecret } from "../../vault/vault.js";

const BASE_URL = "https://connect.mailerlite.com";

/** The ONLY requests this client can make — all GET. */
const ALLOWED_ENDPOINTS: RegExp[] = [
  /^\/api\/subscribers$/, // counts only — see assertAllowed
  /^\/api\/groups$/,
  /^\/api\/campaigns$/,
  /^\/api\/automations$/,
];

/** Query parameters the subscriber COUNT request may carry. */
const SUBSCRIBER_COUNT_PARAMS = new Set(["limit", "filter[status]", "filter[subscribed_from]", "filter[subscribed_to]"]);

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
// 120/min = 2/s. Stay under it: at most ~1.8 requests per second.
const MIN_GAP_MS = 550;

export class MailerLiteError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = "MailerLiteError";
  }
}

export class EndpointNotAllowedError extends Error {
  constructor(method: string, path: string) {
    super(`MailerLite client refused ${method} ${path}: not on the read-only allowlist`);
    this.name = "EndpointNotAllowedError";
  }
}

function loadToken(): string {
  const entry = getSecret("mailerlite"); // throws VaultLockedError if locked
  const token = entry?.credentials.apiToken;
  if (typeof token !== "string" || !token.trim()) {
    throw new MailerLiteError("MailerLite API token is not saved", 400, "not_configured");
  }
  return token.trim();
}

function assertAllowed(method: string, path: string, query: Record<string, string> = {}) {
  if (method !== "GET" || !ALLOWED_ENDPOINTS.some((re) => re.test(path))) {
    throw new EndpointNotAllowedError(method, path);
  }
  // Subscribers: counting is allowed, listing people is not.
  if (path === "/api/subscribers") {
    const keys = Object.keys(query);
    if (query.limit !== "0" || keys.some((k) => !SUBSCRIBER_COUNT_PARAMS.has(k))) {
      throw new EndpointNotAllowedError(method, `${path} (only a limit=0 count is allowed)`);
    }
  }
}

let lastRequestAt = 0;

async function get(path: string, query: Record<string, string> = {}): Promise<unknown> {
  // Check BEFORE the token is loaded or any request is made.
  assertAllowed("GET", path, query);
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const token = loadToken();

  for (let attempt = 0; ; attempt++) {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
    });

    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = res.status === 429
        ? (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000)
        : 2 ** attempt * 2000;
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 130_000)));
      continue;
    }

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) throw toMailerLiteError(res.status, json);
    return json;
  }
}

function toMailerLiteError(status: number, body: unknown): MailerLiteError {
  const b = (body ?? {}) as Record<string, unknown>;
  const fallback: Record<number, string> = {
    401: "MailerLite rejected the API token (wrong, revoked, or its user was removed)",
    403: "MailerLite refused access for this token",
  };
  const message = fallback[status] ?? ((typeof b.message === "string" && b.message) || `MailerLite returned HTTP ${status}`);
  return new MailerLiteError(message, status);
}

// ── Public API ────────────────────────────────────────────────────────────────

export type SubscriberStatus = "active" | "unsubscribed" | "unconfirmed" | "bounced" | "junk";
export const SUBSCRIBER_STATUSES: SubscriberStatus[] = ["active", "unsubscribed", "unconfirmed", "bounced", "junk"];

/** How many subscribers match — a number only, never the subscribers. */
export async function countSubscribers(filter: {
  status?: SubscriberStatus;
  /** Y-m-d, inclusive (UTC) */
  subscribedFrom?: string;
  subscribedTo?: string;
} = {}): Promise<number> {
  const q: Record<string, string> = { limit: "0" };
  if (filter.status) q["filter[status]"] = filter.status;
  if (filter.subscribedFrom) q["filter[subscribed_from]"] = filter.subscribedFrom;
  if (filter.subscribedTo) q["filter[subscribed_to]"] = filter.subscribedTo;
  const res = (await get("/api/subscribers", q)) as { total?: unknown };
  if (typeof res?.total !== "number") throw new MailerLiteError("MailerLite count response had no total", 502);
  return res.total;
}

export interface PageMeta {
  current_page: number;
  last_page: number;
  total: number;
}
export type ListPage = { data: Record<string, unknown>[]; meta: PageMeta };

export async function listGroups(page = 1): Promise<ListPage> {
  return (await get("/api/groups", { page: String(page), limit: "100" })) as ListPage;
}

export async function listSentCampaigns(page = 1, limit = 100): Promise<ListPage> {
  return (await get("/api/campaigns", { "filter[status]": "sent", page: String(page), limit: String(limit) })) as ListPage;
}

export async function listAutomations(page = 1): Promise<ListPage> {
  // with_steps=false: we only want each automation's totals, not its email designs.
  return (await get("/api/automations", { page: String(page), limit: "50", with_steps: "false" })) as ListPage;
}

/** Exported for unit tests of the allowlist. */
export const __test = { assertAllowed };

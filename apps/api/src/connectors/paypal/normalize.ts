// PayPal raw record → Ciara transaction drafts.
//
// Pure functions only (no database), so they're easy to unit test. The
// importer (import.ts) feeds records in and writes the drafts out.
//
// One PayPal record can become 0, 1 or 2 drafts:
//   sale with a fee  → a "sale" at the FULL amount + an "expense" for the fee
//                      (fee is linked to the sale, so the two can be shown
//                      combined as a net amount or broken out)
//   hold / release / currency conversion → nothing (no real money movement;
//                      conversions are used to find the USD value instead)
//
// Event codes: https://developer.paypal.com/docs/transaction-search/transaction-event-codes/

export interface Money {
  currency_code: string;
  value: string;
}

export interface PayPalRecord {
  transaction_info: {
    transaction_id: string;
    paypal_reference_id?: string;
    paypal_reference_id_type?: string;
    transaction_event_code: string;
    transaction_initiation_date: string;
    transaction_amount: Money;
    fee_amount?: Money;
    transaction_status: string; // S success, P pending, D denied, V reversed
    transaction_subject?: string;
    transaction_note?: string;
    invoice_id?: string;
  };
  payer_info?: {
    account_id?: string;
    email_address?: string;
    payer_name?: { given_name?: string; surname?: string; alternate_full_name?: string };
  };
  cart_info?: {
    item_details?: { item_name?: string; item_quantity?: string }[];
    paypal_invoice_id?: string;
  };
}

export type ReviewStatus = "confirmed" | "needs_review" | "personal";

export interface Draft {
  externalId: string;            // dedup key: PayPal ID, or "<id>:fee"
  relatedExternalId?: string;    // the draft this one belongs to (fee → sale)
  type: "sale" | "expense" | "refund" | "transfer";
  amount: number;                // always positive
  currency: string;
  description: string;
  categoryName?: string;         // resolved to an ID by the importer
  channelName?: string;
  categoryId?: string;           // set by a payee rule; wins over categoryName
  channelId?: string;            // set by a payee rule; wins over channelName
  payee?: string;
  counterpartyId?: string;
  reviewStatus: ReviewStatus;
  occurredAt: string;            // YYYY-MM-DD (local date)
  referenceId: string;           // PayPal transaction ID, shown to the user
  notes?: string;
}

export type NormalizeResult =
  | { kind: "drafts"; drafts: Draft[] }
  | { kind: "skip"; reason: string }    // handled — never becomes a transaction
  | { kind: "defer"; reason: string };  // try again on a later run (e.g. pending)

/** Lookups across the whole set of raw records. */
export interface NormalizeContext {
  /** Currency conversions (T0200) keyed by the transaction they converted. */
  conversionsFor: Map<string, PayPalRecord[]>;
  /** IDs of sales that have a partner fee (T0113) pointing at them — i.e. website checkouts. */
  partnerFeeTargets: Set<string>;
}

export const CATEGORY = {
  sales: "Sales Income",
  eventSales: "Event Sales",
  processingFees: "PayPal & Processing Fees",
  platformFees: "Platform Fees",
} as const;

export const CHANNEL = {
  pos: "Convention / Event Sales",
  website: "Website (Squarespace)",
  invoice: "Invoice / Direct Client",
  paypal: "PayPal Direct",
} as const;

// Codes that never become transactions.
const SKIP_CODES: Record<string, string> = {
  T0200: "currency conversion (used for USD value)",
  T1501: "account hold",
  T1105: "hold released",
};

// Payment codes: sign of the amount decides sale vs purchase.
const PAYMENT_LABELS: Record<string, string> = {
  T0000: "PayPal payment",
  T0001: "PayPal mass payment",
  T0003: "Preapproved / recurring payment",
  T0006: "PayPal checkout payment",
  T0007: "PayPal web payment",
  T0011: "PayPal mobile payment",
  T0018: "Point-of-sale payment",
  T1000: "PayPal BillPay payment",
};

// Incoming payments under these codes are confidently business sales.
const CONFIDENT_SALE_CODES = new Set(["T0006", "T0007", "T0018"]);

export function buildContext(records: PayPalRecord[]): NormalizeContext {
  const conversionsFor = new Map<string, PayPalRecord[]>();
  const partnerFeeTargets = new Set<string>();
  for (const r of records) {
    const t = r.transaction_info;
    if (!t.paypal_reference_id) continue;
    if (t.transaction_event_code === "T0200") {
      const list = conversionsFor.get(t.paypal_reference_id) ?? [];
      list.push(r);
      conversionsFor.set(t.paypal_reference_id, list);
    } else if (t.transaction_event_code === "T0113") {
      partnerFeeTargets.add(t.paypal_reference_id);
    }
  }
  return { conversionsFor, partnerFeeTargets };
}

export function normalizePayPal(r: PayPalRecord, ctx: NormalizeContext): NormalizeResult {
  const t = r.transaction_info;
  const code = t.transaction_event_code;

  // Skip codes first: holds stay "pending" forever, so they must not be deferred.
  if (SKIP_CODES[code]) return { kind: "skip", reason: SKIP_CODES[code] };
  if (t.transaction_status === "P") return { kind: "defer", reason: "pending" };
  if (t.transaction_status === "D" || t.transaction_status === "V") {
    return { kind: "skip", reason: t.transaction_status === "D" ? "denied" : "reversed" };
  }

  const value = Number(t.transaction_amount.value);
  if (!Number.isFinite(value) || value === 0) return { kind: "skip", reason: "zero amount" };

  const incoming = value > 0;
  const usd = toUsd(r, ctx);
  const base = {
    referenceId: t.transaction_id,
    occurredAt: localDate(t.transaction_initiation_date),
    currency: usd.currency,
    payee: counterpartyName(r),
    counterpartyId: r.payer_info?.account_id || r.payer_info?.email_address || undefined,
  };
  const noteParts: string[] = [`PayPal ${code}`];
  if (usd.note) noteParts.push(usd.note);
  if (t.transaction_note) noteParts.push(`Note: ${t.transaction_note}`);
  if (t.invoice_id) noteParts.push(`Invoice ${t.invoice_id}`);

  // ── Transfers ─────────────────────────────────────────────────────────────
  if (code === "T0300") {
    return single({
      ...base,
      externalId: t.transaction_id,
      relatedExternalId: t.paypal_reference_id,
      type: "transfer",
      amount: Math.abs(usd.amount),
      description: "Bank → PayPal (funding a payment)",
      reviewStatus: "confirmed",
      payee: undefined,
      counterpartyId: undefined,
      notes: noteParts.join(" · "),
    });
  }
  if (code === "T0403" || code.startsWith("T04")) {
    return single({
      ...base,
      externalId: t.transaction_id,
      type: "transfer",
      amount: Math.abs(usd.amount),
      description: incoming ? "Bank → PayPal" : "PayPal → bank withdrawal",
      reviewStatus: "confirmed",
      payee: undefined,
      counterpartyId: undefined,
      notes: noteParts.join(" · "),
    });
  }

  // ── Partner fee (platform's cut of a website sale) ────────────────────────
  if (code === "T0113") {
    return single({
      ...base,
      externalId: t.transaction_id,
      relatedExternalId: t.paypal_reference_id,
      type: "expense",
      amount: Math.abs(usd.amount),
      description: incoming ? "Platform fee returned" : "Platform partner fee",
      categoryName: CATEGORY.platformFees,
      // A returned fee (after a refund) reduces an expense — there's no type
      // for that, so a person decides how to record it.
      reviewStatus: incoming ? "needs_review" : "confirmed",
      payee: undefined,
      counterpartyId: undefined,
      notes: [...noteParts, incoming ? "Fee returned to you — review" : null].filter(Boolean).join(" · "),
    });
  }

  // ── Refunds ───────────────────────────────────────────────────────────────
  if (code === "T1107") {
    return single({
      ...base,
      externalId: t.transaction_id,
      relatedExternalId: t.paypal_reference_id,
      type: "refund",
      amount: Math.abs(usd.amount),
      description: incoming ? "Refund received from seller" : "Refund to customer",
      // Outgoing = you refunded a customer (reduces income) — routine.
      // Incoming = a seller refunded you (reduces an expense) — review.
      reviewStatus: incoming ? "needs_review" : "confirmed",
      notes: [...noteParts, incoming ? "Money back on a purchase — review" : null].filter(Boolean).join(" · "),
    });
  }

  // ── Payments (sales in, purchases out) ────────────────────────────────────
  const label = PAYMENT_LABELS[code];
  const description = describe(r) ?? label ?? `PayPal ${code}`;
  if (!label) noteParts.push("Unrecognized PayPal event code — review");

  const drafts: Draft[] = [];
  if (incoming) {
    const pos = code === "T0018";
    drafts.push({
      ...base,
      externalId: t.transaction_id,
      type: "sale",
      amount: Math.abs(usd.amount),
      description,
      categoryName: pos ? CATEGORY.eventSales : CATEGORY.sales,
      channelName: saleChannel(r, ctx),
      reviewStatus: CONFIDENT_SALE_CODES.has(code) && usd.currency === "USD" ? "confirmed" : "needs_review",
      notes: noteParts.join(" · "),
    });
  } else {
    drafts.push({
      ...base,
      externalId: t.transaction_id,
      type: "expense",
      amount: Math.abs(usd.amount),
      description,
      // PayPal can't tell business from personal spending — always review.
      reviewStatus: "needs_review",
      notes: noteParts.join(" · "),
    });
  }

  // Processing fee, as its own expense linked to the payment.
  const fee = t.fee_amount ? Number(t.fee_amount.value) : 0;
  if (Number.isFinite(fee) && fee !== 0) {
    const feeUsd = Math.abs(fee) * usd.rate;
    drafts.push({
      ...base,
      externalId: `${t.transaction_id}:fee`,
      relatedExternalId: t.transaction_id,
      type: "expense",
      amount: round2(feeUsd),
      description: `PayPal fee — ${description}`,
      categoryName: CATEGORY.processingFees,
      channelName: drafts[0].channelName,
      payee: "PayPal",
      counterpartyId: undefined,
      // A positive fee means PayPal gave a fee back — unusual, so review it.
      reviewStatus: fee < 0 ? "confirmed" : "needs_review",
      notes: `PayPal ${code} fee${usd.note ? ` · ${usd.note}` : ""}`,
    });
  }

  return { kind: "drafts", drafts };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function single(d: Draft): NormalizeResult {
  return { kind: "drafts", drafts: [d] };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** USD value of a record. Uses PayPal's own currency conversion when one is
 *  linked; otherwise keeps the original currency. `rate` converts the fee. */
function toUsd(r: PayPalRecord, ctx: NormalizeContext) {
  const t = r.transaction_info;
  const value = Number(t.transaction_amount.value);
  const currency = t.transaction_amount.currency_code;
  if (currency === "USD") return { amount: value, currency: "USD", rate: 1, note: undefined };

  const usdLeg = (ctx.conversionsFor.get(t.transaction_id) ?? []).find(
    (c) => c.transaction_info.transaction_amount.currency_code === "USD"
  );
  if (usdLeg) {
    const usdAmount = Math.abs(Number(usdLeg.transaction_info.transaction_amount.value));
    const rate = usdAmount / Math.abs(value);
    return {
      amount: Math.sign(value) * usdAmount,
      currency: "USD",
      rate,
      note: `Originally ${Math.abs(value).toFixed(2)} ${currency}`,
    };
  }
  return { amount: value, currency, rate: 1, note: `No USD conversion found — amount is in ${currency}` };
}

function counterpartyName(r: PayPalRecord): string | undefined {
  const n = r.payer_info?.payer_name;
  const full = n?.alternate_full_name || [n?.given_name, n?.surname].filter(Boolean).join(" ");
  return full || r.payer_info?.email_address || undefined;
}

/** Item names (first two, "+N more") or the transaction subject. */
function describe(r: PayPalRecord): string | undefined {
  const names = (r.cart_info?.item_details ?? [])
    .map((i) => {
      const name = i.item_name?.trim();
      if (!name) return null;
      const qty = Number(i.item_quantity);
      return qty > 1 ? `${name} ×${qty}` : name;
    })
    .filter((x): x is string => !!x);
  if (names.length) {
    return names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2} more` : names.join(", ");
  }
  return r.transaction_info.transaction_subject?.trim() || undefined;
}

function saleChannel(r: PayPalRecord, ctx: NormalizeContext): string {
  const t = r.transaction_info;
  if (t.transaction_event_code === "T0018") return CHANNEL.pos;
  if (r.cart_info?.paypal_invoice_id) return CHANNEL.invoice;
  if (ctx.partnerFeeTargets.has(t.transaction_id)) return CHANNEL.website;
  return CHANNEL.paypal;
}

/** PayPal timestamp → local calendar date (YYYY-MM-DD), so a 9pm sale is
 *  filed on the day it happened here, not the next day in UTC. */
export function localDate(iso: string): string {
  const d = new Date(iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

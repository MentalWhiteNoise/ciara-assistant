// Chase credit card statements → transactions.
//
//   storeChaseCsv()        — keep every uploaded row as a raw record (no transactions yet)
//   previewChaseImport()   — plan what the stored rows become, writes NOTHING
//   runChaseImport()       — same plan, written in ONE database transaction
//
// The card is shared and mixes personal and business spending, so most charges
// go to the Review page, grouped by merchant ("AMAZON MKTPL", "SQSP", …).
// Deciding a merchant with "remember" ticked saves a payee rule (connector
// "chase", counterparty "merchant:<NAME>") and later charges are filed
// automatically on import.
//
// What each row becomes:
//   • Sale / other charge → expense (needs review unless a payee rule decides it)
//   • Return             → refund, same merchant, same review
//   • Payment            → nothing (paying the card off isn't an expense); logged
//                          so it isn't planned again
//   • FOREIGN TRANSACTION FEE → expense linked to the charge it belongs to (same
//                          day, ≈3% of it). It never appears on the Review page by
//                          itself: deciding the charge decides its fee too.
//   • a charge from a print vendor whose order is ALREADY imported from email
//     (IngramSpark invoices, 48HR orders) → NOT a new expense. It's linked to
//     that order (same amount, order dated up to 30 days after the charge) so
//     the money isn't counted twice. Print-vendor charges without a matching
//     order become normal expenses for review, with a note saying so.
//
// import_dedup_log ("chase", row ID) records each row once — pointing at the
// new transaction, the linked order, or nothing (card payments).

import { ulid } from "ulid";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { categories, importDedupLog, importRawRecords, payeeRules, syncJobs, transactions } from "../../db/schema/index.js";
import { INGRAM_CONNECTOR } from "../ingramspark/sync.js";
import { FORTY_EIGHT_CONNECTOR } from "../48hr/sync.js";
import { merchantName, parseChaseCsv, type ChaseRow } from "./parse.js";

export const CHASE_CONNECTOR = "chase";
const FEE_CATEGORY = "PayPal & Processing Fees";
const FOREIGN_FEE = "FOREIGN TRANSACTION FEE";
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Merchants whose orders are imported elsewhere (from email), by Chase merchant name. */
const PRINT_VENDORS: Record<string, { source: string; label: string }> = {
  "LIGHTNINGSRC/INGRAMSPARK": { source: INGRAM_CONNECTOR, label: "IngramSpark invoice" },
  "48 HR BOOKS": { source: FORTY_EIGHT_CONNECTOR, label: "48HR Books order" },
};
/** The vendor dates its order 0–30 days after the card is charged (allow 3 days the other way). */
const LINK_WINDOW = { before: 3, after: 30 };

export interface ChaseRawPayload {
  account: string | null;
  fileName: string;
  /** "csv" now; "pdf" once statement PDFs are read. */
  origin: "csv" | "pdf";
  row: ChaseRow;
}

export const chaseCounterpartyId = (merchant: string) => `merchant:${merchant}`;

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

// ── Upload ──────────────────────────────────────────────────────────────────

export interface ChaseUploadResult {
  fileName: string;
  ok: boolean;
  error?: string;
  account?: string | null;
  rows?: number;
  newRows?: number;
  firstDate?: string | null;
  lastDate?: string | null;
}

/** Saves the file's rows as raw records. Rows already stored (overlapping downloads) are left alone. */
export function storeChaseCsv(fileName: string, text: string): ChaseUploadResult {
  const parsed = parseChaseCsv(text, fileName);
  const now = new Date().toISOString();
  const jobId = ulid();
  let newRows = 0;

  db.transaction((tx) => {
    tx.insert(syncJobs).values({ id: jobId, connector: CHASE_CONNECTOR, status: "running", startedAt: now }).run();
    for (const row of parsed.rows) {
      const payload: ChaseRawPayload = { account: parsed.account, fileName, origin: "csv", row };
      const res = tx.insert(importRawRecords).values({
        id: ulid(),
        connector: CHASE_CONNECTOR,
        externalId: row.externalId,
        occurredAt: row.transactionDate,
        payload: JSON.stringify(payload),
        syncJobId: jobId,
        fetchedAt: now,
      }).onConflictDoNothing().run();
      newRows += res.changes;
    }
    tx.update(syncJobs).set({
      status: "success",
      completedAt: new Date().toISOString(),
      recordsImported: newRows,
      recordsSkipped: parsed.rows.length - newRows,
      config: JSON.stringify({ source: "csv_upload", fileName, account: parsed.account, firstDate: parsed.firstDate, lastDate: parsed.lastDate }),
    }).where(eq(syncJobs.id, jobId)).run();
  });

  return { fileName, ok: true, account: parsed.account, rows: parsed.rows.length, newRows, firstDate: parsed.firstDate, lastDate: parsed.lastDate };
}

// ── Plan ────────────────────────────────────────────────────────────────────

type Kind = "charge" | "refund" | "fee" | "payment" | "link";

interface PlannedRow {
  rawId: string;
  p: ChaseRawPayload;
  kind: Kind;
  merchant: string;
  status: "needs_review" | "confirmed" | "personal";
  categoryId: string | null;
  /** kind "link": the existing vendor transaction. */
  linkTo?: { id: string; occurredAt: string; label: string };
  /** kind "fee": the charge it belongs to — a row in this plan, or an already-imported transaction. */
  feeFor?: { rowId: string } | { transactionId: string };
  /** Print-vendor charge with no matching order. */
  unmatchedVendor?: string;
}

export interface ChaseImportSummary {
  totals: {
    rows: number;
    charges: number; chargeAmount: number;
    refunds: number; refundAmount: number;
    fees: number; feeAmount: number;
    linked: number; linkedAmount: number;
    payments: number;
    needsReview: number;
    filedByRule: number;
    merchantsToReview: number;
  };
  alreadyImported: number;
  links: { date: string; amount: number; merchant: string; linkedTo: string; orderDate: string }[];
  unmatchedVendorCharges: { date: string; amount: number; merchant: string }[];
  feesWithoutCharge: number;
  firstDate: string | null;
  lastDate: string | null;
}

function plan() {
  const raw = db
    .select({ id: importRawRecords.id, externalId: importRawRecords.externalId, payload: importRawRecords.payload })
    .from(importRawRecords)
    .where(eq(importRawRecords.connector, CHASE_CONNECTOR))
    .all();

  const logged = new Map(
    db.select({ externalId: importDedupLog.externalId, transactionId: importDedupLog.transactionId })
      .from(importDedupLog).where(eq(importDedupLog.connector, CHASE_CONNECTOR)).all()
      .map((l) => [l.externalId, l.transactionId]),
  );
  const rules = new Map(
    db.select().from(payeeRules).where(eq(payeeRules.connector, CHASE_CONNECTOR)).all().map((r) => [r.counterpartyId, r]),
  );

  // Vendor orders already linked to a Chase charge can't take a second one.
  const linkedIds = new Set([...logged.values()].filter((v): v is string => !!v));
  const vendorOrders = db
    .select({ id: transactions.id, source: transactions.source, amount: transactions.amount, occurredAt: transactions.occurredAt })
    .from(transactions)
    .where(and(inArray(transactions.source, Object.values(PRINT_VENDORS).map((v) => v.source)), eq(transactions.type, "expense")))
    .all()
    .filter((t) => !linkedIds.has(t.id));

  const rows = raw
    .map((r) => ({ rawId: r.id, p: JSON.parse(r.payload) as ChaseRawPayload }))
    .sort((a, b) => a.p.row.transactionDate.localeCompare(b.p.row.transactionDate) || a.p.row.externalId.localeCompare(b.p.row.externalId));

  const summary: ChaseImportSummary = {
    totals: { rows: 0, charges: 0, chargeAmount: 0, refunds: 0, refundAmount: 0, fees: 0, feeAmount: 0, linked: 0, linkedAmount: 0, payments: 0, needsReview: 0, filedByRule: 0, merchantsToReview: 0 },
    alreadyImported: 0, links: [], unmatchedVendorCharges: [], feesWithoutCharge: 0, firstDate: null, lastDate: null,
  };
  const planned: PlannedRow[] = [];
  const reviewMerchants = new Set<string>();

  // Pass 1: everything except foreign fees (they need their charge planned first).
  for (const { rawId, p } of rows) {
    const r = p.row;
    if (logged.has(r.externalId)) { summary.alreadyImported++; continue; }
    if (r.description.toUpperCase() === FOREIGN_FEE) continue;

    const merchant = merchantName(r.description);
    const rule = rules.get(chaseCounterpartyId(merchant));
    const status: PlannedRow["status"] = !rule ? "needs_review" : rule.action === "personal" ? "personal" : "confirmed";
    const categoryId = rule?.action === "business" ? rule.categoryId ?? null : null;

    if (r.type === "Payment") {
      planned.push({ rawId, p, kind: "payment", merchant, status: "confirmed", categoryId: null });
      continue;
    }

    const vendor = PRINT_VENDORS[merchant];
    if (vendor && r.amount < 0) {
      const amount = round2(-r.amount);
      const match = vendorOrders
        .filter((o) => o.source === vendor.source && Math.abs(o.amount - amount) < 0.005)
        .map((o) => ({ o, gap: days(r.transactionDate, o.occurredAt) }))
        .filter(({ gap }) => gap >= -LINK_WINDOW.before && gap <= LINK_WINDOW.after)
        .sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))[0];
      if (match) {
        vendorOrders.splice(vendorOrders.indexOf(match.o), 1);
        planned.push({ rawId, p, kind: "link", merchant, status: "confirmed", categoryId: null, linkTo: { id: match.o.id, occurredAt: match.o.occurredAt, label: vendor.label } });
        continue;
      }
      planned.push({ rawId, p, kind: "charge", merchant, status, categoryId, unmatchedVendor: vendor.label });
      continue;
    }

    planned.push({ rawId, p, kind: r.amount > 0 ? "refund" : "charge", merchant, status, categoryId });
  }

  // Pass 2: foreign fees → the charge they're 3% of. Chase dates the fee on
  // the day the CHARGE POSTED (charge 12/31, posted 1/1 → fee dated 1/1) and
  // rounds the 3% down, so allow a cent either way.
  const feeDay = (row: ChaseRow) => row.postDate ?? row.transactionDate;
  const chargesByPostDate = new Map<string, PlannedRow[]>();
  for (const pl of planned) {
    if (pl.kind !== "charge" && pl.kind !== "link") continue;
    const d = feeDay(pl.p.row);
    chargesByPostDate.set(d, [...(chargesByPostDate.get(d) ?? []), pl]);
  }
  const feeTaken = new Set<string>();
  for (const { rawId, p } of rows) {
    const r = p.row;
    if (logged.has(r.externalId) || r.description.toUpperCase() !== FOREIGN_FEE) continue;
    const fee = round2(Math.abs(r.amount));
    const near = (charge: number) => Math.abs(charge * 0.03 - fee) <= 0.0101;
    const closeness = (c: PlannedRow) => Math.abs(-c.p.row.amount * 0.03 - fee);

    const parent = (chargesByPostDate.get(r.transactionDate) ?? [])
      .filter((c) => !feeTaken.has(c.p.row.externalId) && near(-c.p.row.amount))
      .sort((a, b) => closeness(a) - closeness(b))[0];
    if (parent) {
      feeTaken.add(parent.p.row.externalId);
      planned.push({ rawId, p, kind: "fee", merchant: parent.merchant, status: parent.status, categoryId: null, feeFor: { rowId: parent.p.row.externalId } });
      continue;
    }
    // The charge may have come in an earlier upload.
    const earlier = rows.find(({ p: q }) =>
      feeDay(q.row) === r.transactionDate && q.row.description.toUpperCase() !== FOREIGN_FEE &&
      logged.get(q.row.externalId) && near(-q.row.amount));
    const earlierTx = earlier ? logged.get(earlier.p.row.externalId)! : null;
    if (earlierTx) {
      const t = db.select({ status: transactions.reviewStatus }).from(transactions).where(eq(transactions.id, earlierTx)).get();
      planned.push({ rawId, p, kind: "fee", merchant: merchantName(earlier!.p.row.description), status: t?.status ?? "needs_review", categoryId: null, feeFor: { transactionId: earlierTx } });
      continue;
    }
    // No charge found: review it on its own.
    summary.feesWithoutCharge++;
    planned.push({ rawId, p, kind: "charge", merchant: FOREIGN_FEE, status: "needs_review", categoryId: null });
  }

  for (const pl of planned) {
    const r = pl.p.row;
    const amt = round2(Math.abs(r.amount));
    summary.totals.rows++;
    if (!summary.firstDate || r.transactionDate < summary.firstDate) summary.firstDate = r.transactionDate;
    if (!summary.lastDate || r.transactionDate > summary.lastDate) summary.lastDate = r.transactionDate;
    switch (pl.kind) {
      case "payment": summary.totals.payments++; continue;
      case "link":
        summary.totals.linked++; summary.totals.linkedAmount = round2(summary.totals.linkedAmount + amt);
        summary.links.push({ date: r.transactionDate, amount: amt, merchant: pl.merchant, linkedTo: pl.linkTo!.label, orderDate: pl.linkTo!.occurredAt });
        continue;
      case "fee": summary.totals.fees++; summary.totals.feeAmount = round2(summary.totals.feeAmount + amt); continue;
      case "refund": summary.totals.refunds++; summary.totals.refundAmount = round2(summary.totals.refundAmount + amt); break;
      case "charge": summary.totals.charges++; summary.totals.chargeAmount = round2(summary.totals.chargeAmount + amt); break;
    }
    if (pl.unmatchedVendor) summary.unmatchedVendorCharges.push({ date: r.transactionDate, amount: amt, merchant: pl.merchant });
    if (pl.status === "needs_review") { summary.totals.needsReview++; reviewMerchants.add(pl.merchant); }
    else summary.totals.filedByRule++;
  }
  summary.totals.merchantsToReview = reviewMerchants.size;
  return { summary, planned };
}

export function previewChaseImport(): ChaseImportSummary {
  return plan().summary;
}

export function runChaseImport(): ChaseImportSummary {
  const { summary, planned } = plan();
  if (planned.length === 0) return summary;
  const now = new Date().toISOString();
  const feeCategoryId = db.select({ id: categories.id }).from(categories).where(eq(categories.name, FEE_CATEGORY)).get()?.id ?? null;
  const card = (p: ChaseRawPayload) => `Chase card${p.account ? ` ••${p.account}` : ""}`;
  const txIdByRow = new Map<string, string>();

  db.transaction((tx) => {
    const log = (externalId: string, transactionId: string | null) =>
      tx.insert(importDedupLog).values({ connector: CHASE_CONNECTOR, externalId, transactionId, importedAt: now }).run();
    const done = (rawId: string) =>
      tx.update(importRawRecords).set({ normalizedAt: now }).where(eq(importRawRecords.id, rawId)).run();

    // Charges, refunds, payments and links first, so fees can point at their charge.
    for (const pl of planned.filter((x) => x.kind !== "fee")) {
      const r = pl.p.row;
      if (pl.kind === "payment") { log(r.externalId, null); done(pl.rawId); continue; }

      if (pl.kind === "link") {
        const existing = tx.select({ notes: transactions.notes }).from(transactions).where(eq(transactions.id, pl.linkTo!.id)).get();
        const line = `Charged to ${card(pl.p)} on ${r.transactionDate}${r.postDate ? ` (posted ${r.postDate})` : ""}.`;
        tx.update(transactions)
          .set({ notes: existing?.notes ? `${existing.notes}\n${line}` : line, updatedAt: now })
          .where(eq(transactions.id, pl.linkTo!.id)).run();
        log(r.externalId, pl.linkTo!.id);
        txIdByRow.set(r.externalId, pl.linkTo!.id);
        done(pl.rawId);
        continue;
      }

      const id = ulid();
      const notes = [
        `${card(pl.p)} · ${r.description}`,
        r.postDate ? `Posted ${r.postDate}` : null,
        r.chaseCategory ? `Chase category: ${r.chaseCategory}` : null,
        pl.unmatchedVendor ? `No ${pl.unmatchedVendor} with this amount was found near this date. It may be an order whose email wasn't imported, or a deposit / changed total. Check before marking it business, so it isn't counted twice.` : null,
        r.memo,
      ].filter(Boolean).join("\n");
      tx.insert(transactions).values({
        id,
        type: pl.kind === "refund" ? "refund" : "expense",
        amount: round2(Math.abs(r.amount)),
        currency: "USD",
        description: r.description,
        categoryId: pl.categoryId,
        payee: pl.merchant,
        paymentMethod: "credit_card",
        source: CHASE_CONNECTOR,
        notes,
        isTaxDeductible: pl.status === "confirmed",
        occurredAt: r.transactionDate,
        reviewStatus: pl.status,
        counterpartyId: chaseCounterpartyId(pl.merchant),
        importedAt: now,
      }).run();
      log(r.externalId, id);
      txIdByRow.set(r.externalId, id);
      done(pl.rawId);
    }

    for (const pl of planned.filter((x) => x.kind === "fee")) {
      const r = pl.p.row;
      const parentId = "rowId" in pl.feeFor! ? txIdByRow.get(pl.feeFor.rowId)! : pl.feeFor!.transactionId;
      const id = ulid();
      tx.insert(transactions).values({
        id,
        type: "expense",
        amount: round2(Math.abs(r.amount)),
        currency: "USD",
        description: `Chase foreign transaction fee — ${pl.merchant}`,
        categoryId: feeCategoryId,
        payee: "Chase",
        paymentMethod: "credit_card",
        source: CHASE_CONNECTOR,
        notes: `${card(pl.p)} · 3% foreign transaction fee on the ${pl.merchant} charge of ${r.transactionDate}.`,
        isTaxDeductible: pl.status === "confirmed",
        occurredAt: r.transactionDate,
        // Follows its charge: the Review page hides it and decides it with the charge.
        reviewStatus: pl.status,
        relatedTransactionId: parentId,
        counterpartyId: null,
        importedAt: now,
      }).run();
      log(r.externalId, id);
      done(pl.rawId);
    }
  });
  return summary;
}

// ── Status ──────────────────────────────────────────────────────────────────

export function getChaseStatus() {
  const raw = db.select({ occurredAt: importRawRecords.occurredAt }).from(importRawRecords)
    .where(eq(importRawRecords.connector, CHASE_CONNECTOR)).all();
  const months = new Map<string, number>();
  for (const r of raw) if (r.occurredAt) months.set(r.occurredAt.slice(0, 7), (months.get(r.occurredAt.slice(0, 7)) ?? 0) + 1);

  const imported = db.select({ status: transactions.reviewStatus, amount: transactions.amount, type: transactions.type })
    .from(transactions).where(eq(transactions.source, CHASE_CONNECTOR)).all();
  const byStatus = { confirmed: 0, needs_review: 0, personal: 0 } as Record<string, number>;
  let businessSpend = 0;
  for (const t of imported) {
    byStatus[t.status]++;
    if (t.status === "confirmed") businessSpend += t.type === "refund" ? -t.amount : t.amount;
  }

  const uploads = db.select({ startedAt: syncJobs.startedAt, recordsImported: syncJobs.recordsImported, recordsSkipped: syncJobs.recordsSkipped, config: syncJobs.config })
    .from(syncJobs).where(eq(syncJobs.connector, CHASE_CONNECTOR)).orderBy(desc(syncJobs.createdAt)).limit(20).all()
    .map((j) => ({ ...JSON.parse(j.config ?? "{}"), startedAt: j.startedAt, newRows: j.recordsImported, duplicateRows: j.recordsSkipped }));

  return {
    storedRows: raw.length,
    months: [...months.entries()].sort().map(([month, rows]) => ({ month, rows })),
    imported: { ...byStatus, total: imported.length, businessSpend: round2(businessSpend) },
    uploads,
    preview: previewChaseImport(),
  };
}

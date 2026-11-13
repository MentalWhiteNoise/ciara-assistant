// Turns downloaded PayPal raw records into Ciara transactions.
//
//   previewPayPalImport()  — runs the normalizer, writes NOTHING, returns counts
//   runPayPalImport()      — same, then writes everything in one DB transaction
//
// Only raw records with normalized_at = NULL are processed, so running it
// again only picks up new downloads. Pending payments are left for a later run.
// import_dedup_log guarantees a PayPal record never becomes two transactions.

import { ulid } from "ulid";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  categories,
  channels,
  importDedupLog,
  importRawRecords,
  payeeRules,
  transactions,
} from "../../db/schema/index.js";
import { buildContext, normalizePayPal, type Draft, type PayPalRecord } from "./normalize.js";

export interface ImportSummary {
  connector: string;
  recordsProcessed: number;
  deferred: number;                         // pending — retried next run
  skipped: Record<string, number>;          // reason → count
  alreadyImported: number;
  created: Record<string, Record<string, number>>; // type → reviewStatus → count
  ruleMatches: number;
  totalsUsd: { sales: number; refunds: number; fees: number; otherExpenses: number };
  nonUsdCount: number;
}

interface Planned {
  rawId: string;
  drafts: Draft[];   // empty for skipped records
  defer: boolean;
}

function plan(connector: string) {
  const all = db
    .select({ id: importRawRecords.id, payload: importRawRecords.payload, normalizedAt: importRawRecords.normalizedAt })
    .from(importRawRecords)
    .where(eq(importRawRecords.connector, connector))
    .all();

  // Context needs ALL records (a sale's partner fee or conversion may have
  // been processed in an earlier run).
  const parsed = all.map((r) => ({ ...r, record: JSON.parse(r.payload) as PayPalRecord }));
  const ctx = buildContext(parsed.map((p) => p.record));

  const rules = new Map(
    db.select().from(payeeRules).where(eq(payeeRules.connector, connector)).all()
      .map((r) => [r.counterpartyId, r])
  );

  const summary: ImportSummary = {
    connector,
    recordsProcessed: 0,
    deferred: 0,
    skipped: {},
    alreadyImported: 0,
    created: {},
    ruleMatches: 0,
    totalsUsd: { sales: 0, refunds: 0, fees: 0, otherExpenses: 0 },
    nonUsdCount: 0,
  };
  const planned: Planned[] = [];

  for (const p of parsed) {
    if (p.normalizedAt) continue;
    summary.recordsProcessed++;
    const result = normalizePayPal(p.record, ctx);

    if (result.kind === "defer") {
      summary.deferred++;
      planned.push({ rawId: p.id, drafts: [], defer: true });
      continue;
    }
    if (result.kind === "skip") {
      summary.skipped[result.reason] = (summary.skipped[result.reason] ?? 0) + 1;
      planned.push({ rawId: p.id, drafts: [], defer: false });
      continue;
    }

    const drafts: Draft[] = [];
    for (const d of result.drafts) {
      if (isImported(connector, d.externalId)) {
        summary.alreadyImported++;
        continue;
      }
      // Payee rule: a past decision about this party overrides "needs review".
      const rule = d.counterpartyId ? rules.get(d.counterpartyId) : undefined;
      if (rule && d.reviewStatus === "needs_review" && (d.type === "expense" || d.type === "sale")) {
        summary.ruleMatches++;
        d.reviewStatus = rule.action === "personal" ? "personal" : "confirmed";
        if (rule.action === "business") {
          d.categoryId = rule.categoryId ?? undefined;
          d.channelId = rule.channelId ?? undefined;
        }
      }
      drafts.push(d);

      const byStatus = (summary.created[d.type] ??= {});
      byStatus[d.reviewStatus] = (byStatus[d.reviewStatus] ?? 0) + 1;
      if (d.currency !== "USD") summary.nonUsdCount++;
      else if (d.reviewStatus !== "personal") {
        if (d.type === "sale") summary.totalsUsd.sales += d.amount;
        else if (d.type === "refund") summary.totalsUsd.refunds += d.amount;
        else if (d.type === "expense" && d.externalId.endsWith(":fee")) summary.totalsUsd.fees += d.amount;
        else if (d.type === "expense") summary.totalsUsd.otherExpenses += d.amount;
      }
    }
    planned.push({ rawId: p.id, drafts, defer: false });
  }

  for (const k of Object.keys(summary.totalsUsd) as (keyof ImportSummary["totalsUsd"])[]) {
    summary.totalsUsd[k] = Math.round(summary.totalsUsd[k] * 100) / 100;
  }
  return { summary, planned };
}

function isImported(connector: string, externalId: string) {
  return !!db
    .select({ id: importDedupLog.externalId })
    .from(importDedupLog)
    .where(and(eq(importDedupLog.connector, connector), eq(importDedupLog.externalId, externalId)))
    .get();
}

export function previewPayPalImport(connector: string): ImportSummary {
  return plan(connector).summary;
}

export function runPayPalImport(connector: string): ImportSummary {
  const { summary, planned } = plan(connector);
  const now = new Date().toISOString();

  const categoryIds = new Map(db.select({ id: categories.id, name: categories.name }).from(categories).all().map((c) => [c.name, c.id]));
  const channelIds = new Map(db.select({ id: channels.id, name: channels.name }).from(channels).all().map((c) => [c.name, c.id]));

  // better-sqlite3 transactions are synchronous: everything below commits
  // together or not at all.
  db.transaction((tx) => {
    const idByExternal = new Map<string, string>();
    const links: { txId: string; relatedExternalId: string }[] = [];

    for (const p of planned) {
      if (p.defer) continue;
      for (const d of p.drafts) {
        const txId = ulid();
        tx.insert(transactions).values({
          id: txId,
          type: d.type,
          amount: d.amount,
          currency: d.currency,
          description: d.description,
          categoryId: d.categoryId ?? (d.categoryName ? categoryIds.get(d.categoryName) : undefined) ?? null,
          channelId: d.channelId ?? (d.channelName ? channelIds.get(d.channelName) : undefined) ?? null,
          payee: d.payee ?? null,
          counterpartyId: d.counterpartyId ?? null,
          paymentMethod: "PayPal",
          referenceId: d.referenceId,
          source: connector,
          notes: d.notes ?? null,
          occurredAt: d.occurredAt,
          reviewStatus: d.reviewStatus,
          importedAt: now,
          createdAt: now,
          updatedAt: now,
        }).run();
        tx.insert(importDedupLog).values({ connector, externalId: d.externalId, transactionId: txId, importedAt: now }).run();
        idByExternal.set(d.externalId, txId);
        if (d.relatedExternalId) links.push({ txId, relatedExternalId: d.relatedExternalId });
      }
      tx.update(importRawRecords).set({ normalizedAt: now }).where(eq(importRawRecords.id, p.rawId)).run();
    }

    // Link fees/transfers/refunds to their payment — which may have been
    // created in this run or an earlier one.
    for (const l of links) {
      const relatedId =
        idByExternal.get(l.relatedExternalId) ??
        tx.select({ id: importDedupLog.transactionId })
          .from(importDedupLog)
          .where(and(eq(importDedupLog.connector, connector), eq(importDedupLog.externalId, l.relatedExternalId)))
          .get()?.id;
      if (relatedId) {
        tx.update(transactions).set({ relatedTransactionId: relatedId }).where(eq(transactions.id, l.txId)).run();
      }
    }
  });

  return summary;
}

/** How many raw records haven't been turned into transactions yet. */
export function countUnprocessed(connector: string): number {
  return db
    .select({ id: importRawRecords.id })
    .from(importRawRecords)
    .where(and(eq(importRawRecords.connector, connector), isNull(importRawRecords.normalizedAt)))
    .all().length;
}

// KDP import — takes an uploaded .xlsx, figures out which report it is, and
// writes it to the database in a single SQLite transaction (all or nothing).
//
// Re-importing is always safe:
//   • Payments   — upserted by (sales month, marketplace, payment number).
//                  Each PAID payout becomes exactly one income transaction.
//   • Statement  — the month's rows are replaced.
//   • Orders     — every row in the file's date range is replaced.
// Uploading the byte-for-byte same file twice is detected and skipped.

import { createHash } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ulid } from "ulid";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  categories,
  channels,
  importDedupLog,
  kdpDailyKenp,
  kdpDailySales,
  kdpImports,
  kdpPaymentLines,
  kdpPayments,
  kdpStatementLines,
  transactions,
} from "../../db/schema/index.js";
import { readWorkbook } from "./xlsx.js";
import { parseKdpReport, type ParsedPayment } from "./parse.js";
import { monthLabel, refreshKdpReminders, todayIso } from "./schedule.js";

const CONNECTOR = "amazon_kdp";

// Bump when parsing changes in a way that's worth re-importing old files for.
//   1 — initial
//   2 — print sales from Paperback/Hardcover sheets, with customer order date
export const PARSER_VERSION = 2;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ?? path.resolve(__dirname, "../../../../../data");
const importsDir = path.join(dataDir, "imports", "kdp");

export interface ImportResult {
  fileName: string;
  ok: boolean;
  duplicate?: boolean;
  reportType?: "payments" | "statement" | "orders";
  summary?: string;      // human-readable one-liner
  coverage?: string | null;
  rowsImported?: number;
  transactionsCreated?: number;
  warnings: string[];
  error?: string;
}

const REPORT_NAMES = {
  payments: "Payments report",
  statement: "Monthly statement",
  orders: "Orders report",
} as const;

export function importKdpFile(fileName: string, buffer: Buffer): ImportResult {
  const fileHash = createHash("sha256").update(buffer).digest("hex");

  // Same file, already parsed by the current parser → nothing to do.
  const previous = db
    .select()
    .from(kdpImports)
    .where(and(eq(kdpImports.fileHash, fileHash), gte(kdpImports.parserVersion, PARSER_VERSION)))
    .get();
  if (previous) {
    return {
      fileName,
      ok: true,
      duplicate: true,
      reportType: previous.reportType,
      coverage: previous.coverage,
      summary: `Already imported on ${previous.importedAt.slice(0, 10)} — nothing new.`,
      warnings: [],
    };
  }

  let report;
  try {
    report = parseKdpReport(readWorkbook(new Uint8Array(buffer)));
  } catch (err) {
    return { fileName, ok: false, warnings: [], error: (err as Error).message };
  }

  // Keep a copy of the original file next to the database.
  const importId = ulid();
  const ext = path.extname(fileName).toLowerCase() || ".xlsx";
  const storedName = `${importId}${ext}`;
  mkdirSync(importsDir, { recursive: true });
  writeFileSync(path.join(importsDir, storedName), buffer);

  const warnings: string[] = [];
  let rowsImported = 0;
  let transactionsCreated = 0;
  let coverage: string | null = null;
  let summary = "";
  const today = todayIso();

  db.transaction((tx) => {
    tx.insert(kdpImports)
      .values({
        id: importId,
        reportType: report.type,
        originalName: fileName,
        storedName,
        fileHash,
        parserVersion: PARSER_VERSION,
        importedAt: new Date().toISOString(),
      })
      .run();

    if (report.type === "payments") {
      const periods = report.payments.map((p) => p.salesPeriod).sort();
      coverage = `${periods[0]}..${periods[periods.length - 1]}`;
      for (const p of report.payments) {
        if (upsertPayment(tx, p, importId)) transactionsCreated++;
        rowsImported++;
      }
      for (const p of report.payments.filter((p) => p.status !== "Paid")) {
        warnings.push(
          `${p.marketplace} payout for ${monthLabel(p.salesPeriod)} (${p.accruedRoyalty ?? "?"} ${p.currency}) ` +
            `has status "${p.status}". Check the bank details in your KDP account settings; KDP normally retries in a later payment.`
        );
      }
      const withheld = report.payments.filter((p) => (p.taxWithholding ?? 0) > 0);
      if (withheld.length) {
        warnings.push(
          `${withheld.length} payout(s) had tax withheld — keep these for your tax return (possible foreign tax credit).`
        );
      }
      summary =
        `${report.payments.length} payouts covering ${monthLabel(periods[0])} – ${monthLabel(periods[periods.length - 1])}` +
        (transactionsCreated ? `; ${transactionsCreated} new income transaction(s) added.` : "; no new payouts.");
    }

    if (report.type === "statement") {
      coverage = report.period;
      tx.delete(kdpStatementLines).where(eq(kdpStatementLines.period, report.period)).run();
      for (const line of report.lines) {
        tx.insert(kdpStatementLines).values({ id: ulid(), period: report.period, importId, ...line }).run();
        rowsImported++;
      }
      const label = monthLabel(report.period);
      if (report.period >= today.slice(0, 7)) {
        warnings.push(
          `${label} isn't over yet, so this statement is incomplete. That's fine to look at, ` +
            `but download it again after the 15th of next month for the final numbers.`
        );
      } else if (report.kenpPending) {
        warnings.push(
          `Kindle Unlimited (KENP) earnings for ${label} aren't calculated yet — KDP sets the per-page rate ` +
            `around the 15th of the following month. Download this statement again after that.`
        );
      }
      summary = `${label} statement: ${report.lines.length} lines.`;
    }

    if (report.type === "orders") {
      coverage = `${report.from}..${report.to}`;
      tx.delete(kdpDailySales)
        .where(and(gte(kdpDailySales.date, report.from), lte(kdpDailySales.date, report.to)))
        .run();
      tx.delete(kdpDailyKenp)
        .where(and(gte(kdpDailyKenp.date, report.from), lte(kdpDailyKenp.date, report.to)))
        .run();
      for (const s of report.sales) {
        tx.insert(kdpDailySales).values({ id: ulid(), importId, ...s }).run();
      }
      for (const k of report.kenp) {
        tx.insert(kdpDailyKenp).values({ id: ulid(), importId, ...k }).run();
      }
      rowsImported = report.sales.length + report.kenp.length;
      summary = `Daily data ${report.from} → ${report.to}: ${report.sales.length} sales rows, ${report.kenp.length} page-read rows.`;
    }

    tx.update(kdpImports)
      .set({
        coverage,
        rowsImported,
        transactionsCreated,
        warnings: warnings.length ? JSON.stringify(warnings) : null,
      })
      .where(eq(kdpImports.id, importId))
      .run();
  });

  refreshKdpReminders();

  return {
    fileName,
    ok: true,
    reportType: report.type,
    summary: `${REPORT_NAMES[report.type]} — ${summary}`,
    coverage,
    rowsImported,
    transactionsCreated,
    warnings,
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Upserts one payout. Returns true if a new income transaction was created. */
function upsertPayment(tx: Tx, p: ParsedPayment, importId: string): boolean {
  const now = new Date().toISOString();
  const existing = tx
    .select()
    .from(kdpPayments)
    .where(
      and(
        eq(kdpPayments.salesPeriod, p.salesPeriod),
        eq(kdpPayments.marketplace, p.marketplace),
        eq(kdpPayments.paymentNumber, p.paymentNumber)
      )
    )
    .get();

  const { lines, ...fields } = p;
  const id = existing?.id ?? ulid();
  if (existing) {
    tx.update(kdpPayments).set({ ...fields, importId, updatedAt: now }).where(eq(kdpPayments.id, id)).run();
    tx.delete(kdpPaymentLines).where(eq(kdpPaymentLines.paymentId, id)).run();
  } else {
    tx.insert(kdpPayments).values({ id, ...fields, importId, updatedAt: now }).run();
  }
  for (const line of lines) {
    tx.insert(kdpPaymentLines).values({ id: ulid(), paymentId: id, ...line }).run();
  }

  // Only money that actually arrived becomes an income transaction.
  if (p.status !== "Paid" || !p.payoutAmount || p.payoutAmount <= 0) return false;

  // The dedup log remembers every payout we've ever turned into a transaction —
  // if the owner later deletes that transaction, we respect that and don't re-add it.
  const externalId = `payment:${p.salesPeriod}:${p.marketplace}:${p.paymentNumber}`;
  const seen = tx
    .select()
    .from(importDedupLog)
    .where(and(eq(importDedupLog.connector, CONNECTOR), eq(importDedupLog.externalId, externalId)))
    .get();
  if (seen) return false;

  const categoryId = tx.select({ id: categories.id }).from(categories).where(eq(categories.name, "Royalties")).get()?.id;
  const channelId = tx.select({ id: channels.id }).from(channels).where(eq(channels.connector, CONNECTOR)).get()?.id;

  const noteParts = [
    `Accrued ${p.accruedRoyalty ?? "?"} ${p.currency}`,
    p.fxRate && p.currency !== (p.payoutCurrency ?? "USD") ? `FX ${p.fxRate}` : null,
    p.taxWithholding ? `Tax withheld ${p.taxWithholding} ${p.currency}` : null,
    lines.length ? lines.map((l) => `${l.source}: ${l.netEarnings ?? "?"}`).join(", ") : null,
    `KDP payment #${p.paymentNumber}`,
  ].filter(Boolean);

  const txId = ulid();
  tx.insert(transactions)
    .values({
      id: txId,
      type: "sale",
      amount: p.payoutAmount,
      currency: p.payoutCurrency ?? "USD",
      description: `KDP royalties — ${p.marketplace} (${monthLabel(p.salesPeriod)} sales)`,
      categoryId: categoryId ?? null,
      channelId: channelId ?? null,
      payee: "Amazon KDP",
      paymentMethod: p.paymentMethod,
      referenceId: p.paymentNumber,
      source: CONNECTOR,
      notes: noteParts.join(" · "),
      occurredAt: p.paymentDate ?? `${p.salesPeriod}-28`,
      importedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  tx.insert(importDedupLog).values({ connector: CONNECTOR, externalId, transactionId: txId, importedAt: now }).run();
  tx.update(kdpPayments).set({ transactionId: txId }).where(eq(kdpPayments.id, id)).run();
  return true;
}

// ── Summaries for the KDP page ───────────────────────────────────────────────

export interface MonthSummary {
  month: string;
  hasStatement: boolean;
  paidUnits: number;
  freeUnits: number;
  kenpPages: number;
  earningsUsd: number | null;   // statement earnings converted with KDP's own FX rates
  earningsPartial: boolean;     // some currency had no FX rate yet (not paid out yet)
  paidOutUsd: number | null;    // what KDP actually paid for this month's sales
  paymentDate: string | null;
}

/** USD conversion rates KDP used for each (sales month, currency), from the Payments report. */
function fxRates(): Map<string, number> {
  const rows = db
    .select({
      period: kdpPayments.salesPeriod,
      currency: kdpPayments.currency,
      fx: sql<number | null>`avg(${kdpPayments.fxRate})`,
    })
    .from(kdpPayments)
    .where(sql`${kdpPayments.fxRate} is not null`)
    .groupBy(kdpPayments.salesPeriod, kdpPayments.currency)
    .all();
  return new Map(rows.filter((r) => r.fx).map((r) => [`${r.period}|${r.currency}`, r.fx!]));
}

/** Latest known FX rate per currency — used for months that haven't been paid out yet. */
function latestFx(): Map<string, number> {
  const rows = db
    .select({ period: kdpPayments.salesPeriod, currency: kdpPayments.currency, fx: kdpPayments.fxRate })
    .from(kdpPayments)
    .where(sql`${kdpPayments.fxRate} is not null`)
    .orderBy(kdpPayments.salesPeriod)
    .all();
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.currency, r.fx!);
  return map;
}

export function getMonthlySummary(): MonthSummary[] {
  const fx = fxRates();
  const fallbackFx = latestFx();
  const byMonth = new Map<string, MonthSummary>();
  const get = (month: string) => {
    let m = byMonth.get(month);
    if (!m) {
      m = {
        month, hasStatement: false, paidUnits: 0, freeUnits: 0, kenpPages: 0,
        earningsUsd: null, earningsPartial: false, paidOutUsd: null, paymentDate: null,
      };
      byMonth.set(month, m);
    }
    return m;
  };

  const lines = db
    .select({
      period: kdpStatementLines.period,
      format: kdpStatementLines.format,
      transactionType: kdpStatementLines.transactionType,
      currency: kdpStatementLines.currency,
      netUnits: kdpStatementLines.netUnits,
      earnings: kdpStatementLines.earnings,
    })
    .from(kdpStatementLines)
    .all();

  for (const l of lines) {
    const m = get(l.period);
    m.hasStatement = true;
    if (l.format === "kenp") m.kenpPages += l.netUnits ?? 0;
    else if ((l.transactionType ?? "").toLowerCase().startsWith("free")) m.freeUnits += l.netUnits ?? 0;
    else m.paidUnits += l.netUnits ?? 0;

    if (l.earnings) {
      const cur = l.currency ?? "USD";
      let rate = cur === "USD" ? 1 : fx.get(`${l.period}|${cur}`);
      if (rate === undefined) {
        rate = fallbackFx.get(cur);
        m.earningsPartial = true;   // estimated with a recent rate, or not converted at all
      }
      if (rate !== undefined) m.earningsUsd = (m.earningsUsd ?? 0) + l.earnings * rate;
    }
  }

  const paid = db
    .select({
      period: kdpPayments.salesPeriod,
      total: sql<number>`sum(${kdpPayments.payoutAmount})`,
      date: sql<string | null>`max(${kdpPayments.paymentDate})`,
    })
    .from(kdpPayments)
    .where(eq(kdpPayments.status, "Paid"))
    .groupBy(kdpPayments.salesPeriod)
    .all();
  for (const p of paid) {
    const m = get(p.period);
    m.paidOutUsd = p.total;
    m.paymentDate = p.date;
  }

  return [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
}

export function getRecentImports(limit = 15) {
  return db
    .select()
    .from(kdpImports)
    .orderBy(sql`${kdpImports.importedAt} desc`)
    .limit(limit)
    .all()
    .map((i) => ({ ...i, warnings: i.warnings ? (JSON.parse(i.warnings) as string[]) : [] }));
}

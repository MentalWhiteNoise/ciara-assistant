// KDP report schedule — what's due, and the reminders that go with it.
//
// KDP's timing (why the dates below are what they are):
//   • Monthly statement for month M is final around the 15th of M+1 — that's when
//     KDP sets the Kindle Unlimited per-page rate. Before then KENP earnings are "N/A".
//   • Payouts for month M arrive about 60 days after it ends (end of M+2).
//     So by the 15th, last month's end-of-month payout has always landed.
//   • The Orders report is daily sales by order date — needed for correlating
//     sales with events. KDP only gives DAILY rows for ranges of ~2 months or
//     less (longer ranges come back as monthly totals), so it's pulled monthly
//     with an overlapping range and the daily history accumulates in Ciara.
//
// So there is ONE monthly routine, around the 15th–20th, covering all three.
//
// Reminders are ordinary checklists + tasks (they show up on Tasks, Checklists
// and the Dashboard). Each task carries a machine-readable tag like
// "kdp:statement:2026-10"; when a matching file is imported the task is ticked
// off automatically. `reminder_keys` remembers what was created, so a reminder
// the owner deletes is never re-created.

import { ulid } from "ulid";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  checklists,
  kdpDailySales,
  kdpImports,
  kdpPayments,
  kdpStatementLines,
  reminderKeys,
  tasks,
} from "../../db/schema/index.js";

export const STATEMENT_READY_DAY = 15; // statement for last month is final from here
export const REMINDER_CREATE_DAY = 10; // monthly checklist appears (a few days' warning)
export const ROUTINE_DUE_DAY = 20;     // monthly checklist due date

// ── Date helpers (local time, ISO strings) ───────────────────────────────────

export function todayIso(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function pad(n: number) {
  return String(n).padStart(2, "0");
}
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function dayOf(month: string, day: number) {
  return `${month}-${pad(day)}`;
}

/** Most recent month whose statement should be final by `today`. */
export function latestClosedMonth(today: string): string {
  const thisMonth = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  return addMonths(thisMonth, day >= STATEMENT_READY_DAY ? -1 : -2);
}

// ── Status ───────────────────────────────────────────────────────────────────

export type MonthState = "final" | "provisional" | "missing";

export interface ReportStatus {
  state: "up_to_date" | "due" | "never";
  lastImportedAt: string | null;
  detail: string;   // one line explaining where things stand
  nextDue: string;  // ISO date of the next time this should be pulled
}

export interface KdpStatus {
  today: string;
  latestClosedMonth: string;
  statement: ReportStatus;
  payments: ReportStatus & { failed: { salesPeriod: string; marketplace: string; accrued: number | null; currency: string }[] };
  orders: ReportStatus & { coveredThrough: string | null };
  coverage: { month: string; state: MonthState }[]; // oldest → newest
  missingMonths: string[];
}

function lastImport(type: "payments" | "statement" | "orders") {
  return (
    db
      .select({ at: sql<string | null>`max(${kdpImports.importedAt})` })
      .from(kdpImports)
      .where(eq(kdpImports.reportType, type))
      .get()?.at ?? null
  );
}

/** Per-month statement state: final, provisional (KENP earnings not set yet), or missing. */
function statementMonths(): Map<string, MonthState> {
  const rows = db
    .select({
      period: kdpStatementLines.period,
      pending: sql<number>`sum(case when ${kdpStatementLines.format} = 'kenp' and ${kdpStatementLines.earnings} is null then 1 else 0 end)`,
    })
    .from(kdpStatementLines)
    .groupBy(kdpStatementLines.period)
    .all();
  return new Map(rows.map((r) => [r.period, r.pending > 0 ? "provisional" : "final"]));
}

/** Earliest month we know the account had activity (from any KDP data). */
function earliestKnownMonth(): string | null {
  const candidates = [
    db.select({ m: sql<string | null>`min(${kdpPayments.salesPeriod})` }).from(kdpPayments).get()?.m,
    db.select({ m: sql<string | null>`min(${kdpStatementLines.period})` }).from(kdpStatementLines).get()?.m,
    db.select({ m: sql<string | null>`substr(min(${kdpDailySales.date}), 1, 7)` }).from(kdpDailySales).get()?.m,
  ].filter((m): m is string => !!m);
  return candidates.length ? candidates.sort()[0] : null;
}

export function getKdpStatus(today = todayIso()): KdpStatus {
  const closed = latestClosedMonth(today);
  const thisMonth = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  const months = statementMonths();

  // Coverage grid: every month from first known activity through the latest closed month.
  const coverage: { month: string; state: MonthState }[] = [];
  const first = earliestKnownMonth();
  if (first) {
    for (let m = first; m <= closed; m = addMonths(m, 1)) {
      coverage.push({ month: m, state: months.get(m) ?? "missing" });
    }
  }
  const missingMonths = coverage.filter((c) => c.state !== "final").map((c) => c.month);

  // Statement
  const nextStatementDue =
    day >= STATEMENT_READY_DAY ? dayOf(addMonths(thisMonth, 1), STATEMENT_READY_DAY) : dayOf(thisMonth, STATEMENT_READY_DAY);
  const closedState = months.get(closed);
  const statement: ReportStatus = {
    state: closedState === "final" ? "up_to_date" : months.size === 0 ? "never" : "due",
    lastImportedAt: lastImport("statement"),
    nextDue: closedState === "final" ? nextStatementDue : today,
    detail:
      closedState === "final"
        ? months.get(addMonths(closed, 1)) === "final"
          ? `Statements imported through ${monthLabel(addMonths(closed, 1))}.`
          : `${monthLabel(closed)} statement imported. ${monthLabel(addMonths(closed, 1))} is ready from ${nextStatementDue}.`
        : closedState === "provisional"
          ? `${monthLabel(closed)} was imported before KDP finished it (KU earnings were N/A). Download it again.`
          : `${monthLabel(closed)} statement is ready to download.`,
  };

  // Payments — a new payout lands at the end of every month.
  const paymentsAt = lastImport("payments");
  const sinceFirst = dayOf(thisMonth, 1);
  const latestPaid = db
    .select({ p: sql<string | null>`max(${kdpPayments.salesPeriod})` })
    .from(kdpPayments)
    .get()?.p;
  const failed = db
    .select()
    .from(kdpPayments)
    .where(sql`${kdpPayments.status} <> 'Paid'`)
    .all()
    .map((p) => ({ salesPeriod: p.salesPeriod, marketplace: p.marketplace, accrued: p.accruedRoyalty, currency: p.currency }));
  const paymentsCurrent = !!paymentsAt && paymentsAt.slice(0, 10) >= sinceFirst;
  const payments = {
    state: (paymentsAt ? (paymentsCurrent ? "up_to_date" : "due") : "never") as ReportStatus["state"],
    lastImportedAt: paymentsAt,
    nextDue: paymentsCurrent ? dayOf(addMonths(thisMonth, 1), 1) : today,
    detail: paymentsAt
      ? `Payouts on file through ${latestPaid ? monthLabel(latestPaid) : "—"} sales.` +
        (paymentsCurrent ? "" : " Last month's payout should be in a fresh download.")
      : "No payments imported yet.",
    failed,
  };

  // Orders (optional daily estimates)
  const ordersAt = lastImport("orders");
  const coveredThrough =
    db.select({ d: sql<string | null>`max(${kdpDailySales.date})` }).from(kdpDailySales).get()?.d ?? null;
  const ordersCurrent = !!ordersAt && ordersAt.slice(0, 10) >= sinceFirst;
  const orders = {
    state: (ordersAt ? (ordersCurrent ? "up_to_date" : "due") : "never") as ReportStatus["state"],
    lastImportedAt: ordersAt,
    nextDue: ordersCurrent ? dayOf(addMonths(thisMonth, 1), 1) : today,
    detail: coveredThrough
      ? `Daily sales on file through ${coveredThrough}.` + (ordersCurrent ? "" : " Download the latest to keep the daily history unbroken.")
      : "No daily sales imported yet.",
    coveredThrough,
  };

  return { today, latestClosedMonth: closed, statement, payments, orders, coverage, missingMonths };
}

// ── Reminders ────────────────────────────────────────────────────────────────

const HOW_TO = "Open Ciara → Money → KDP Royalties for step-by-step instructions, then drop the file there.";

const ORDERS_TASK = {
  title: "Import KDP Orders report",
  description:
    `KDP → Reports → Orders → date range: 1st of last month → today, "All books" → Download report.\nDaily sales with real order dates — used to see how events, promos and ads affect sales. Keep the range to two months or less, or KDP sends monthly totals instead.\n${HOW_TO}`,
};

/** Orders used to be optional; bring any reminder created back then up to date. */
function upgradeOptionalOrdersTasks() {
  db.update(tasks)
    .set({ ...ORDERS_TASK, priority: "high", updatedAt: new Date().toISOString() })
    .where(and(like(tasks.tags, '%"kdp:orders:%'), eq(tasks.title, "Import KDP Orders report (optional)")))
    .run();
}

function parseTags(raw: string | null): string[] {
  try {
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function claimKey(key: string, checklistId: string | null): boolean {
  const res = db.insert(reminderKeys).values({ key, checklistId }).onConflictDoNothing().run();
  return res.changes > 0;
}

function hasKey(key: string) {
  return !!db.select().from(reminderKeys).where(eq(reminderKeys.key, key)).get();
}

function createMonthlyReminder(today: string) {
  const thisMonth = today.slice(0, 7);
  const salesMonth = addMonths(thisMonth, -1);
  const key = `kdp:monthly:${salesMonth}`;
  if (hasKey(key)) return;

  const now = new Date().toISOString();
  const checklistId = ulid();
  const scheduled = dayOf(thisMonth, STATEMENT_READY_DAY);
  const due = dayOf(thisMonth, ROUTINE_DUE_DAY);
  const since = dayOf(thisMonth, 1);
  const label = monthLabel(salesMonth);

  db.transaction((tx) => {
    tx.insert(checklists)
      .values({
        id: checklistId,
        name: `KDP reports — ${label}`,
        description:
          `Monthly Amazon KDP downloads. Best done between the ${STATEMENT_READY_DAY}th and ${ROUTINE_DUE_DAY}th, ` +
          `after KDP has finalized ${label}'s Kindle Unlimited earnings. Items tick themselves off when you import the file.`,
        dueDate: due,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const items = [
      {
        title: `Import KDP statement for ${label}`,
        description:
          `KDP → Reports → Prior Months' Royalties → choose ${label} → Download report.\n` +
          `Wait until the ${STATEMENT_READY_DAY}th — before that, KU page-read earnings show "N/A".\n${HOW_TO}`,
        priority: "high" as const,
        tag: `kdp:statement:${salesMonth}`,
      },
      {
        title: "Import KDP Payments report",
        description:
          `KDP → Reports → Payments → leave "All Sales Periods" → Download report.\n` +
          `Picks up the payout KDP sent at the end of last month.\n${HOW_TO}`,
        priority: "high" as const,
        tag: `kdp:payments:${since}`,
      },
      {
        title: ORDERS_TASK.title,
        description: ORDERS_TASK.description,
        priority: "high" as const,
        tag: `kdp:orders:${since}`,
      },
    ];
    items.forEach((item, i) => {
      tx.insert(tasks)
        .values({
          id: ulid(),
          title: item.title,
          description: item.description,
          priority: item.priority,
          status: "todo",
          scheduledDate: scheduled,
          dueDate: due,
          checklistId,
          sortOrder: i,
          tags: JSON.stringify(["kdp", item.tag]),
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });
    tx.insert(reminderKeys).values({ key, checklistId }).run();
  });
}

function createBackfillReminder(today: string, missing: string[], closed: string) {
  // The latest closed month is covered by the monthly checklist; this is for history.
  const history = missing.filter((m) => m !== closed);
  if (history.length === 0 || hasKey("kdp:backfill")) return;

  const now = new Date().toISOString();
  const due = new Date(today + "T12:00:00");
  due.setDate(due.getDate() + 30);
  const id = ulid();
  if (!claimKey("kdp:backfill", null)) return;
  db.insert(tasks)
    .values({
      id,
      title: `Backfill KDP monthly statements (${history.length} month${history.length === 1 ? "" : "s"} missing)`,
      description:
        `One-time catch-up: download a Prior Months' Royalties statement for each missing month ` +
        `(${monthLabel(history[0])} → ${monthLabel(history[history.length - 1])}). ` +
        `You can select them all at once on the KDP Royalties page — the coverage grid shows what's left.\n${HOW_TO}`,
      priority: "medium",
      status: "todo",
      dueDate: todayIso(due),
      tags: JSON.stringify(["kdp", "kdp:backfill"]),
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

/** Ticks off any KDP reminder task whose report has now been imported. */
function autoComplete(status: KdpStatus) {
  const open = db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.status, ["todo", "in_progress"]), like(tasks.tags, '%"kdp:%')))
    .all();
  if (open.length === 0) return;

  const months = statementMonths();
  const importedSince = (type: "payments" | "orders", since: string) =>
    !!db
      .select({ id: kdpImports.id })
      .from(kdpImports)
      .where(and(eq(kdpImports.reportType, type), sql`substr(${kdpImports.importedAt}, 1, 10) >= ${since}`))
      .get();

  const now = new Date().toISOString();
  const touchedChecklists = new Set<string>();

  for (const task of open) {
    const tag = parseTags(task.tags).find((t) => t.startsWith("kdp:"));
    if (!tag) continue;
    const [, kind, arg] = tag.split(":");
    const done =
      (kind === "statement" && months.get(arg) === "final") ||
      (kind === "payments" && importedSince("payments", arg)) ||
      (kind === "orders" && importedSince("orders", arg)) ||
      (kind === "backfill" && status.missingMonths.filter((m) => m !== status.latestClosedMonth).length === 0);
    if (!done) continue;

    db.update(tasks).set({ status: "done", completedAt: now, updatedAt: now }).where(eq(tasks.id, task.id)).run();
    if (task.checklistId) touchedChecklists.add(task.checklistId);
  }

  // Close a reminder checklist once everything in it is done or skipped.
  for (const id of touchedChecklists) {
    const remaining = db
      .select({ n: sql<number>`count(*)` })
      .from(tasks)
      .where(and(eq(tasks.checklistId, id), inArray(tasks.status, ["todo", "in_progress"])))
      .get()?.n ?? 0;
    if (remaining === 0) {
      db.update(checklists).set({ status: "completed", updatedAt: now }).where(eq(checklists.id, id)).run();
    }
  }
}

/**
 * Create any reminders that are due and tick off ones that are satisfied.
 * Safe to call as often as you like — runs on startup, every few hours, and
 * after every import.
 */
export function refreshKdpReminders(today = todayIso()) {
  upgradeOptionalOrdersTasks();
  const day = Number(today.slice(8, 10));
  if (day >= REMINDER_CREATE_DAY) createMonthlyReminder(today);
  const status = getKdpStatus(today);
  createBackfillReminder(today, status.missingMonths, status.latestClosedMonth);
  autoComplete(status);
}

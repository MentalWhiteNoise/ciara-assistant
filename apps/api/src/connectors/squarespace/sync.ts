// Squarespace history download — stores orders, transactions and products RAW
// in import_raw_records (connector "squarespace"). It creates no Ciara
// transactions; an importer (built once we've seen real data) does that.
//
// External IDs are prefixed with the record kind so they can't collide:
//   order:<id>        — what was sold (line items, channel web/pos, shipping status)
//   transaction:<id>  — the money (payments + processor, fees, refunds, taxes)
//   product:<id>      — the catalog
//
// Modes:
//   full        — every record Squarespace has (no date limit, unlike PayPal)
//   incremental — only records MODIFIED since the last successful sync (minus a
//                 1-day overlap), so refunds/fulfilment changes to old orders are
//                 picked up. Products are always re-read in full (small catalog).

import { ulid } from "ulid";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { importRawRecords, syncJobs } from "../../db/schema/index.js";
import {
  SquarespaceError,
  listOrders,
  listProducts,
  listTransactions,
  type ListOpts,
  type ModifiedRange,
  type Pagination,
} from "./client.js";

export const SQUARESPACE_CONNECTOR = "squarespace";
const DAY_MS = 24 * 60 * 60 * 1000;
const INCREMENTAL_OVERLAP_DAYS = 1;
// Earliest date the cursor-free fallback asks about (before Squarespace Commerce existed).
const EPOCH = new Date("2010-01-01T00:00:00Z");
// Safety valve against a pagination bug looping forever (50/page → 100k records).
const MAX_PAGES_PER_KIND = 2000;

export type SyncMode = "full" | "incremental";
type Kind = "order" | "transaction" | "product";

interface JobConfig {
  mode: SyncMode;
  /** Only set for incremental runs. */
  start?: string;
  end: string;
  /** Which kinds finished, e.g. ["order", "transaction"]. */
  completedKinds?: Kind[];
  /** The kind currently downloading. */
  current?: Kind;
  recordsUpdated?: number;
  byKind?: Partial<Record<Kind, number>>;
  /** Kinds where Squarespace rejected its own cursor and date paging was used. */
  pagingFallback?: Kind[];
}

type Page = { items: Record<string, unknown>[]; pagination: Pagination };

let running: string | null = null;

export function isSquarespaceSyncRunning() {
  return running !== null;
}

export function startSquarespaceSync(mode: SyncMode): string {
  if (running) throw new Error("A Squarespace sync is already running");

  const end = new Date(Date.now() - 60_000);
  const start = mode === "incremental" ? incrementalStart() : null;
  const config: JobConfig = start
    ? { mode: "incremental", start: start.toISOString(), end: end.toISOString() }
    : { mode: "full", end: end.toISOString() };

  const jobId = ulid();
  db.insert(syncJobs)
    .values({
      id: jobId,
      connector: SQUARESPACE_CONNECTOR,
      status: "running",
      startedAt: new Date().toISOString(),
      config: JSON.stringify(config),
    })
    .run();

  running = jobId;
  const range = start ? { after: start, before: end } : undefined;
  void runJob(jobId, range, config).finally(() => {
    running = null;
  });
  return jobId;
}

function incrementalStart(): Date | null {
  const last = db
    .select({ config: syncJobs.config })
    .from(syncJobs)
    .where(and(eq(syncJobs.connector, SQUARESPACE_CONNECTOR), eq(syncJobs.status, "success")))
    .orderBy(desc(syncJobs.createdAt), desc(syncJobs.id))
    .get();
  if (!last?.config) return null;
  const cfg = JSON.parse(last.config) as JobConfig;
  return new Date(new Date(cfg.end).getTime() - INCREMENTAL_OVERLAP_DAYS * DAY_MS);
}

async function runJob(jobId: string, range: ModifiedRange | undefined, config: JobConfig) {
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  config.completedKinds = [];
  config.byKind = {};

  const saveProgress = (extra: Partial<typeof syncJobs.$inferInsert> = {}) =>
    db.update(syncJobs)
      .set({
        recordsImported: inserted,
        recordsSkipped: unchanged,
        config: JSON.stringify({ ...config, recordsUpdated: updated }),
        ...extra,
      })
      .where(eq(syncJobs.id, jobId))
      .run();

  const store = (kind: Kind, items: Record<string, unknown>[]) => {
    for (const item of items) {
      const r = storeRaw(jobId, kind, item);
      if (r === "inserted") inserted++;
      else if (r === "updated") updated++;
      else unchanged++;
      if (r !== "skipped") config.byKind![kind] = (config.byKind![kind] ?? 0) + 1;
    }
    saveProgress();
  };

  // Walks every page of one list endpoint and stores each item. Normally
  // follows Squarespace's nextPageUrl; if Squarespace rejects its own cursor
  // ("Invalid cursor"), finishes the job by paging on dates instead.
  async function pull(kind: Kind, fetchPage: (opts: ListOpts) => Promise<Page>, fullRange: ModifiedRange | undefined) {
    config.current = kind;
    saveProgress();
    let nextPageUrl: string | undefined;
    let page = 0;
    try {
      for (; page < MAX_PAGES_PER_KIND; page++) {
        const res = await fetchPage({ nextPageUrl, range: fullRange });
        store(kind, res.items);
        if (!res.pagination?.hasNextPage || !res.pagination.nextPageUrl) break;
        nextPageUrl = res.pagination.nextPageUrl;
      }
    } catch (err) {
      if (!(err instanceof SquarespaceError && /invalid cursor/i.test(err.message))) throw err;
      config.pagingFallback = [...(config.pagingFallback ?? []), kind];
      await pullByDate(kind, fetchPage, fullRange, page);
    }
    config.completedKinds!.push(kind);
    config.current = undefined;
    saveProgress();
  }

  // Cursor-free paging ("keyset" paging): ask for one date range, then shrink
  // the range past the records just received, and repeat until a page says
  // there's nothing more. Works whichever way Squarespace sorts the page.
  // Records on a boundary may be fetched twice — harmless, rows are upserted.
  async function pullByDate(kind: Kind, fetchPage: (opts: ListOpts) => Promise<Page>, fullRange: ModifiedRange | undefined, pagesUsed: number) {
    let lo = fullRange?.after ?? EPOCH;
    let hi = fullRange?.before ?? new Date();
    for (let page = pagesUsed; page < MAX_PAGES_PER_KIND && lo < hi; page++) {
      const res = await fetchPage({ range: { after: lo, before: hi } });
      store(kind, res.items);
      if (!res.pagination?.hasNextPage || res.items.length === 0) return;

      const times = res.items
        .map((i) => (typeof i.modifiedOn === "string" ? new Date(i.modifiedOn).getTime() : NaN))
        .filter(Number.isFinite);
      if (times.length === 0) throw new Error(`Squarespace ${kind}s have no modifiedOn — can't page by date`);
      const ascending = times[0] <= times[times.length - 1];
      if (ascending) {
        // Got the oldest part of the range → move the start forward.
        const next = Math.max(...times);
        lo = new Date(next > lo.getTime() ? next : lo.getTime() + 1);
      } else {
        // Got the newest part → move the end back.
        const next = Math.min(...times);
        hi = new Date(next < hi.getTime() ? next : hi.getTime() - 1);
      }
    }
  }

  try {
    await pull("order", async (o) => {
      const r = await listOrders(o);
      return { items: r.result ?? [], pagination: r.pagination };
    }, range);
    await pull("transaction", async (o) => {
      const r = await listTransactions(o);
      return { items: r.documents ?? [], pagination: r.pagination };
    }, range);
    await pull("product", async (o) => {
      const r = await listProducts(o);
      return { items: r.products ?? [], pagination: r.pagination };
    }, undefined); // always the full catalog
    saveProgress({ status: "success", completedAt: new Date().toISOString() });
  } catch (err) {
    saveProgress({
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: (err as Error).message, // SquarespaceError messages never include the key
    });
  }
}

function storeRaw(jobId: string, kind: Kind, record: Record<string, unknown>): "inserted" | "updated" | "unchanged" | "skipped" {
  if (typeof record.id !== "string") return "skipped"; // malformed
  const externalId = `${kind}:${record.id}`;
  const occurredAt = typeof record.createdOn === "string" ? new Date(record.createdOn).toISOString() : null;
  const payload = JSON.stringify(record);
  const now = new Date().toISOString();

  const existing = db
    .select({ id: importRawRecords.id, payload: importRawRecords.payload })
    .from(importRawRecords)
    .where(and(eq(importRawRecords.connector, SQUARESPACE_CONNECTOR), eq(importRawRecords.externalId, externalId)))
    .get();

  if (!existing) {
    db.insert(importRawRecords)
      .values({ id: ulid(), connector: SQUARESPACE_CONNECTOR, externalId, occurredAt, payload, syncJobId: jobId, fetchedAt: now })
      .run();
    return "inserted";
  }
  if (existing.payload === payload) {
    db.update(importRawRecords).set({ fetchedAt: now }).where(eq(importRawRecords.id, existing.id)).run();
    return "unchanged";
  }
  db.update(importRawRecords)
    .set({ payload, occurredAt, syncJobId: jobId, fetchedAt: now, normalizedAt: null })
    .where(eq(importRawRecords.id, existing.id))
    .run();
  return "updated";
}

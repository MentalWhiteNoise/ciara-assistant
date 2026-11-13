// PayPal history download — fetches transactions and stores them RAW in
// import_raw_records. It does not create Ciara transactions; that's the
// normalizer's job (next step). So running this is always safe: worst case
// it downloads things we later ignore.
//
// PayPal Transaction Search limits:
//   • each request covers at most 31 days → we walk the range in 30-day windows
//   • history goes back 3 years → "full" mode starts just inside that limit
//   • new activity can take up to ~3 hours to appear → "incremental" mode
//     re-reads the last few days so late arrivals aren't missed (duplicates
//     are harmless: rows are keyed by PayPal's transaction ID)

import { ulid } from "ulid";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { importRawRecords, syncJobs } from "../../db/schema/index.js";
import { getPayPalConnectorKey, searchTransactions } from "./client.js";

// Connector key is "paypal" (Live) or "paypal_sandbox" — decided per job from
// the saved Environment, so sandbox test data never mixes with real data.
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const MAX_HISTORY_DAYS = 3 * 365 - 2; // a little inside PayPal's 3-year limit
const INCREMENTAL_OVERLAP_DAYS = 3;

export type SyncMode = "full" | "incremental";

interface JobConfig {
  mode: SyncMode;
  start: string;
  end: string;
  /** How far the job got — lets a failed backfill be resumed later. */
  completedThrough?: string;
  recordsUpdated?: number;
}

// Only one PayPal download at a time.
let running: string | null = null;

export function isPayPalSyncRunning() {
  return running !== null;
}

/** Starts a sync in the background and returns its job id immediately. */
export function startPayPalSync(mode: SyncMode): string {
  if (running) throw new Error("A PayPal sync is already running");
  const connector = getPayPalConnectorKey();

  const end = new Date(Date.now() - 60_000);
  const start = mode === "incremental" ? incrementalStart(connector) : null;
  const effectiveMode: SyncMode = start ? "incremental" : "full";
  const rangeStart = start ?? new Date(end.getTime() - MAX_HISTORY_DAYS * DAY_MS);

  const jobId = ulid();
  const config: JobConfig = { mode: effectiveMode, start: rangeStart.toISOString(), end: end.toISOString() };
  db.insert(syncJobs)
    .values({
      id: jobId,
      connector,
      status: "running",
      startedAt: new Date().toISOString(),
      config: JSON.stringify(config),
    })
    .run();

  running = jobId;
  // Fire and forget — progress is written to the sync_jobs row as we go.
  void runJob(connector, jobId, rangeStart, end, config).finally(() => {
    running = null;
  });
  return jobId;
}

/** Last successful sync's end minus an overlap, or null if there's never been one. */
function incrementalStart(connector: string): Date | null {
  const last = db
    .select({ config: syncJobs.config })
    .from(syncJobs)
    .where(and(eq(syncJobs.connector, connector), eq(syncJobs.status, "success")))
    .orderBy(desc(syncJobs.createdAt), desc(syncJobs.id))
    .get();
  if (!last?.config) return null;
  const cfg = JSON.parse(last.config) as JobConfig;
  return new Date(new Date(cfg.end).getTime() - INCREMENTAL_OVERLAP_DAYS * DAY_MS);
}

async function runJob(connector: string, jobId: string, start: Date, end: Date, config: JobConfig) {
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

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

  try {
    for (let wStart = start; wStart < end; ) {
      const wEnd = new Date(Math.min(wStart.getTime() + WINDOW_DAYS * DAY_MS, end.getTime()));

      for (let page = 1, totalPages = 1; page <= totalPages; page++) {
        const res = await searchTransactions({ start: wStart, end: wEnd, page, pageSize: 500 });
        totalPages = res.total_pages || 1;

        for (const record of res.transaction_details ?? []) {
          const r = storeRaw(connector, jobId, record);
          if (r === "inserted") inserted++;
          else if (r === "updated") updated++;
          else unchanged++;
        }
      }

      config.completedThrough = wEnd.toISOString();
      saveProgress();
      wStart = wEnd;
    }

    saveProgress({ status: "success", completedAt: new Date().toISOString() });
  } catch (err) {
    saveProgress({
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: (err as Error).message, // PayPalError messages are safe (no tokens/secrets)
    });
  }
}

/** Insert or refresh one raw PayPal record. Changed payloads are marked for
 *  re-normalizing (e.g. a pending payment that has since completed). */
function storeRaw(connector: string, jobId: string, record: unknown): "inserted" | "updated" | "unchanged" {
  const info = (record as { transaction_info?: Record<string, unknown> }).transaction_info ?? {};
  const externalId = info.transaction_id;
  if (typeof externalId !== "string") return "unchanged"; // malformed — skip
  const occurredAt = typeof info.transaction_initiation_date === "string"
    ? new Date(info.transaction_initiation_date).toISOString()
    : null;
  const payload = JSON.stringify(record);
  const now = new Date().toISOString();

  const existing = db
    .select({ id: importRawRecords.id, payload: importRawRecords.payload })
    .from(importRawRecords)
    .where(and(eq(importRawRecords.connector, connector), eq(importRawRecords.externalId, externalId)))
    .get();

  if (!existing) {
    db.insert(importRawRecords)
      .values({ id: ulid(), connector, externalId, occurredAt, payload, syncJobId: jobId, fetchedAt: now })
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

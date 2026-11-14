// Shared plumbing for importers that read the reports inbox (IngramSpark,
// 48HR Books, …): fetching matching mail READ-ONLY, logging sync runs, keeping
// original files, and storing raw records.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ulid } from "ulid";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { importRawRecords, syncJobs } from "../../db/schema/index.js";
import { withMailbox } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const dataDir = process.env.DATA_DIR ?? path.resolve(__dirname, "../../../../../data");

/** Incremental runs look back this far before the last successful run. */
const OVERLAP_DAYS = 7;

/** Start of the last successful Gmail run for a connector (null = never). */
export function lastSuccessfulGmailRun(connector: string): Date | null {
  const last = db
    .select({ startedAt: syncJobs.startedAt, config: syncJobs.config })
    .from(syncJobs)
    .where(and(eq(syncJobs.connector, connector), eq(syncJobs.status, "success")))
    .orderBy(desc(syncJobs.createdAt), desc(syncJobs.id))
    .all()
    .find((j) => j.config && JSON.parse(j.config).source === "gmail");
  return last?.startedAt ? new Date(last.startedAt) : null;
}

/**
 * Download every message matching a Gmail search (plus anything with an
 * attached .eml, for forwarded backlogs). `full` ignores the last run date.
 * The mailbox is opened read-only, so nothing in Gmail changes.
 */
export async function fetchFromGmail(connector: string, query: string, { full = false } = {}) {
  const last = full ? null : lastSuccessfulGmailRun(connector);
  const since = last ? new Date(last.getTime() - OVERLAP_DAYS * 86_400_000) : null;
  const base = `(${query}) OR filename:eml`;
  const gmailQuery = since ? `(${base}) after:${since.toISOString().slice(0, 10).replace(/-/g, "/")}` : base;
  const emails = await withMailbox("ALL_MAIL", async (client) => {
    const found = await client.search({ gmraw: gmailQuery }, { uid: true });
    const uids = Array.isArray(found) ? found : [];
    const out: Buffer[] = [];
    if (uids.length === 0) return out;
    for await (const msg of client.fetch(uids, { uid: true, source: true }, { uid: true })) {
      if (msg.source) out.push(msg.source);
    }
    return out;
  });
  return { emails, mode: since ? ("incremental" as const) : ("full" as const), gmailQuery };
}

/** Every .eml file under a folder (recursively) — for dry runs and backfills. */
export function readEmlFolder(folder: string): Buffer[] {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.eml$/i.test(e.name)) files.push(p);
    }
  };
  walk(folder);
  return files.map((f) => fs.readFileSync(f));
}

/** Keep an original file under data/imports/<dir>/<sub>/; returns its path relative to data/. */
export function keepFile(dir: string, sub: string, name: string, content: Buffer): string {
  const target = path.join(dataDir, "imports", dir, sub);
  fs.mkdirSync(target, { recursive: true });
  const full = path.join(target, name);
  if (!fs.existsSync(full)) fs.writeFileSync(full, content);
  return path.relative(dataDir, full).split(path.sep).join("/");
}

export type StoreOutcome = "inserted" | "updated" | "unchanged";

/**
 * Insert or refresh one raw record. `core` picks the part of the payload that
 * matters for "has it changed?" (so the same email seen via a different route
 * isn't treated as a change). Changed → normalized_at reset.
 */
export function storeRawRecord(
  connector: string,
  jobId: string,
  externalId: string,
  occurredAt: string | null,
  payload: unknown,
  core: (p: any) => unknown = (p) => p
): StoreOutcome {
  const json = JSON.stringify(payload);
  const now = new Date().toISOString();
  const existing = db
    .select({ id: importRawRecords.id, payload: importRawRecords.payload })
    .from(importRawRecords)
    .where(and(eq(importRawRecords.connector, connector), eq(importRawRecords.externalId, externalId)))
    .get();
  if (!existing) {
    db.insert(importRawRecords)
      .values({ id: ulid(), connector, externalId, occurredAt, payload: json, syncJobId: jobId, fetchedAt: now })
      .run();
    return "inserted";
  }
  if (JSON.stringify(core(JSON.parse(existing.payload))) === JSON.stringify(core(payload))) {
    db.update(importRawRecords).set({ fetchedAt: now }).where(eq(importRawRecords.id, existing.id)).run();
    return "unchanged";
  }
  db.update(importRawRecords)
    .set({ payload: json, occurredAt, fetchedAt: now, syncJobId: jobId, normalizedAt: null })
    .where(eq(importRawRecords.id, existing.id))
    .run();
  return "updated";
}

/** Run `fn` as a logged sync job (sync_jobs row: running → success/failed). */
export async function runSyncJob<T extends object>(
  connector: string,
  config: Record<string, unknown>,
  fn: (jobId: string) => Promise<T>,
  counts: (r: T) => { imported: number; skipped: number }
): Promise<T> {
  const jobId = ulid();
  db.insert(syncJobs)
    .values({ id: jobId, connector, status: "running", startedAt: new Date().toISOString(), config: JSON.stringify(config) })
    .run();
  try {
    const result = await fn(jobId);
    const c = counts(result);
    db.update(syncJobs)
      .set({
        status: "success",
        completedAt: new Date().toISOString(),
        recordsImported: c.imported,
        recordsSkipped: c.skipped,
        config: JSON.stringify({ ...config, result }),
      })
      .where(eq(syncJobs.id, jobId))
      .run();
    return result;
  } catch (err) {
    db.update(syncJobs)
      .set({ status: "failed", completedAt: new Date().toISOString(), errorMessage: (err as Error).message })
      .where(eq(syncJobs.id, jobId))
      .run();
    throw err;
  }
}

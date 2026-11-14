// MailerLite download — stores newsletter STATS in import_raw_records
// (connector "mailerlite"). No subscriber is ever downloaded: the client only
// allows subscriber COUNTS. Nothing here creates transactions.
//
// External IDs are prefixed with the record kind:
//   snapshot:<YYYY-MM-DD>  — subscriber counts by status + per-group counts,
//                            taken at sync time (one per day; a 2nd run that
//                            day replaces it). A series of these = list growth.
//   signups:<YYYY-MM>      — how many people signed up in that month
//                            (MailerLite's subscribed_from/to count filter)
//   campaign:<id>          — a sent campaign: dates, subject, recipients, opens,
//                            clicks, unsubscribes. Trimmed: no email text,
//                            no sender address.
//   automation:<id>        — an automation's running totals (emails sent etc.)
//
// Modes:
//   full        — also back-fills signups:* for the last SIGNUP_HISTORY_MONTHS
//   incremental — signups:* for this month and last month only
// Campaigns, automations and groups are small, and their stats keep changing
// after sending, so they are always re-read in full.

import { ulid } from "ulid";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { importRawRecords, syncJobs } from "../../db/schema/index.js";
import {
  SUBSCRIBER_STATUSES,
  countSubscribers,
  listAutomations,
  listGroups,
  listSentCampaigns,
  type ListPage,
} from "./client.js";
import { mlDate, signupMonths, trimAutomation, trimCampaign, trimGroup } from "./shape.js";

export const MAILERLITE_CONNECTOR = "mailerlite";
const SIGNUP_HISTORY_MONTHS = 36;
const MAX_PAGES = 200; // safety valve against a pagination loop

export type SyncMode = "full" | "incremental";
type Kind = "snapshot" | "signups" | "campaign" | "automation";

interface JobConfig {
  mode: SyncMode;
  end: string;
  current?: Kind;
  completedKinds?: Kind[];
  recordsUpdated?: number;
  byKind?: Partial<Record<Kind, number>>;
}

let running: string | null = null;

export function isMailerLiteSyncRunning() {
  return running !== null;
}

export function startMailerLiteSync(mode: SyncMode): string {
  if (running) throw new Error("A MailerLite sync is already running");
  const config: JobConfig = { mode, end: new Date().toISOString() };
  const jobId = ulid();
  db.insert(syncJobs)
    .values({
      id: jobId,
      connector: MAILERLITE_CONNECTOR,
      status: "running",
      startedAt: new Date().toISOString(),
      config: JSON.stringify(config),
    })
    .run();
  running = jobId;
  void runJob(jobId, config).finally(() => {
    running = null;
  });
  return jobId;
}

async function allPages(fetchPage: (page: number) => Promise<ListPage>) {
  const items: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetchPage(page);
    items.push(...(res.data ?? []));
    if (!res.meta || res.meta.current_page >= res.meta.last_page || (res.data ?? []).length === 0) break;
  }
  return items;
}

async function runJob(jobId: string, config: JobConfig) {
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

  const store = (kind: Kind, id: string, occurredAt: string | null, record: unknown) => {
    const r = storeRaw(jobId, `${kind}:${id}`, occurredAt, record);
    if (r === "inserted") inserted++;
    else if (r === "updated") updated++;
    else unchanged++;
    config.byKind![kind] = (config.byKind![kind] ?? 0) + 1;
  };
  const begin = (kind: Kind) => {
    config.current = kind;
    saveProgress();
  };
  const done = (kind: Kind) => {
    config.completedKinds!.push(kind);
    config.current = undefined;
    saveProgress();
  };

  try {
    // 1. Today's subscriber counts + group counts.
    begin("snapshot");
    const takenAt = new Date().toISOString();
    const subscribers: Record<string, number> = { total: await countSubscribers() };
    for (const status of SUBSCRIBER_STATUSES) subscribers[status] = await countSubscribers({ status });
    const groups = (await allPages(listGroups)).map(trimGroup);
    store("snapshot", takenAt.slice(0, 10), takenAt, { takenAt, subscribers, groups });
    done("snapshot");

    // 2. Signups per month.
    begin("signups");
    const months = signupMonths(new Date(), config.mode === "full" ? SIGNUP_HISTORY_MONTHS : 2);
    for (const [month, from, to] of months) {
      const total = await countSubscribers({ subscribedFrom: from, subscribedTo: to });
      store("signups", month, `${from}T00:00:00.000Z`, { month, from, to, total });
      saveProgress();
    }
    done("signups");

    // 3. Sent campaigns.
    begin("campaign");
    for (const c of await allPages((p) => listSentCampaigns(p))) {
      if (c.id == null) continue;
      store("campaign", String(c.id), mlDate(c.finished_at) ?? mlDate(c.started_at) ?? mlDate(c.created_at), trimCampaign(c));
    }
    done("campaign");

    // 4. Automations (running totals).
    begin("automation");
    for (const a of await allPages(listAutomations)) {
      if (a.id == null) continue;
      store("automation", String(a.id), mlDate(a.created_at), trimAutomation(a));
    }
    done("automation");

    saveProgress({ status: "success", completedAt: new Date().toISOString() });
  } catch (err) {
    saveProgress({
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: (err as Error).message, // MailerLiteError messages never include the token
    });
  }
}

function storeRaw(jobId: string, externalId: string, occurredAt: string | null, record: unknown): "inserted" | "updated" | "unchanged" {
  const payload = JSON.stringify(record);
  const now = new Date().toISOString();
  const existing = db
    .select({ id: importRawRecords.id, payload: importRawRecords.payload })
    .from(importRawRecords)
    .where(and(eq(importRawRecords.connector, MAILERLITE_CONNECTOR), eq(importRawRecords.externalId, externalId)))
    .get();

  if (!existing) {
    db.insert(importRawRecords)
      .values({ id: ulid(), connector: MAILERLITE_CONNECTOR, externalId, occurredAt, payload, syncJobId: jobId, fetchedAt: now })
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

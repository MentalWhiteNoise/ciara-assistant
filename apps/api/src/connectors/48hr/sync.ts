// 48HR Books "sync": collect 48HR emails and store each one as a raw record.
//
// Unlike Ingram (one self-contained invoice per email), a 48HR order is spread
// over many emails — confirmation, proofs, notes, a revised confirmation after
// extras are added, a "ready for pick up" note. So every relevant email is
// stored on its own ("email:<message-id>") with what was read from it, and
// import.ts rebuilds each order from all of its emails.
//
// Sources: the shared reports inbox (Gmail, READ-ONLY), or a folder of saved
// .eml files (dry runs, backfills — no network).

import { createHash } from "node:crypto";
import { fromText, unpackEmail } from "../gmail/unpack.js";
import { fetchFromGmail, keepFile, readEmlFolder, runSyncJob, storeRawRecord } from "../gmail/collect.js";
import {
  classify48HrEmail,
  cleanTitle,
  htmlToLines,
  orderNumberFrom,
  parseConfirmation,
  type FortyEightConfirmation,
  type FortyEightEmailKind,
} from "./parse.js";

export { dataDir } from "../gmail/collect.js";

export const FORTY_EIGHT_CONNECTOR = "48hr_books";
const FILES_DIR = "48hr"; // data/imports/48hr/
const GMAIL_QUERY = "from:48hrbooks.com";

export interface FortyEightEmailPayload {
  orderNumber: string;
  kind: Exclude<FortyEightEmailKind, "other">;
  date: string | null;     // email date (ISO)
  subject: string;
  title: string | null;    // "Book Title" if the email has a believable one
  confirmation: FortyEightConfirmation | null;
  messageId: string | null;
  emlFile: string;         // relative to data/
}

export interface FortyEightSyncResult {
  source: "gmail" | "folder";
  mode: "full" | "incremental";
  emailsSeen: number;
  byKind: Record<string, number>;
  stored: { inserted: number; updated: number; unchanged: number };
  problems: string[];
}

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

async function processEmails(jobId: string, rawEmails: Buffer[], result: FortyEightSyncResult) {
  const seen = new Set<string>();
  for (const raw of rawEmails) {
    for (const { raw: emlRaw, parsed } of await unpackEmail(raw)) {
      const from = fromText(parsed);
      const subject = parsed.subject ?? "";
      const lines = parsed.html
        ? htmlToLines(String(parsed.html))
        : (parsed.text ?? "").split(/\n/).map((l) => l.trim()).filter(Boolean);
      const kind = classify48HrEmail(from, subject, lines.join("\n"));
      if (kind === "other") continue;
      const orderNumber = orderNumberFrom(subject);
      if (!orderNumber) continue;

      const key = parsed.messageId ?? sha(emlRaw);
      if (seen.has(key)) continue;
      seen.add(key);
      result.emailsSeen++;
      result.byKind[kind] = (result.byKind[kind] ?? 0) + 1;

      const day = parsed.date ? parsed.date.toISOString().slice(0, 10) : "undated";
      const confirmation = kind === "confirmation" ? parseConfirmation(subject, lines) : null;
      if (kind === "confirmation" && !confirmation) {
        result.problems.push(`${day} "${subject}": couldn't read the order totals`);
      }
      const titleLine = lines.find((l) => /^book title:/i.test(l));
      const payload: FortyEightEmailPayload = {
        orderNumber,
        kind,
        date: parsed.date?.toISOString() ?? null,
        subject,
        title: confirmation?.title ?? cleanTitle(titleLine?.slice("book title:".length)),
        confirmation,
        messageId: parsed.messageId ?? null,
        emlFile: keepFile(FILES_DIR, "emails", `${day}_${orderNumber}_${sha(emlRaw).slice(0, 10)}.eml`, emlRaw),
      };
      const r = storeRawRecord(
        FORTY_EIGHT_CONNECTOR, jobId, `email:${key}`, payload.date, payload,
        (p: FortyEightEmailPayload) => ({ kind: p.kind, title: p.title, confirmation: p.confirmation })
      );
      result.stored[r]++;
    }
  }
}

function emptyResult(source: FortyEightSyncResult["source"], mode: FortyEightSyncResult["mode"]): FortyEightSyncResult {
  return { source, mode, emailsSeen: 0, byKind: {}, stored: { inserted: 0, updated: 0, unchanged: 0 }, problems: [] };
}
const counts = (r: FortyEightSyncResult) => ({ imported: r.stored.inserted, skipped: r.stored.unchanged });

export function sync48HrFromGmail({ full = false } = {}): Promise<FortyEightSyncResult> {
  return runSyncJob(FORTY_EIGHT_CONNECTOR, { source: "gmail", full }, async (jobId) => {
    const { emails, mode } = await fetchFromGmail(FORTY_EIGHT_CONNECTOR, GMAIL_QUERY, { full });
    const result = emptyResult("gmail", mode);
    await processEmails(jobId, emails, result);
    return result;
  }, counts);
}

export function sync48HrFromFolder(folder: string): Promise<FortyEightSyncResult> {
  return runSyncJob(FORTY_EIGHT_CONNECTOR, { source: "folder", folder }, async (jobId) => {
    const result = emptyResult("folder", "full");
    await processEmails(jobId, readEmlFolder(folder), result);
    return result;
  }, counts);
}

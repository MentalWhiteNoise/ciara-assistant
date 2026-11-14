// Wise "sync" (email stage): collect Wise transfer emails from the shared
// reports inbox (READ-ONLY) or a folder of saved .eml files, and store each as
// a raw record keyed by its Wise transfer number.
//
//   "transfer:<number>"         — a "Transfer sent" email (who, how much, fee)
//   "problem:<number>:<msgid>"  — a "problem with your transfer" email
//
// The transfer number is Wise's own ID, so when the Wise API is connected
// later its records line up with these and nothing is imported twice.

import { createHash } from "node:crypto";
import { fromText, unpackEmail } from "../gmail/unpack.js";
import { fetchFromGmail, keepFile, readEmlFolder, runSyncJob, storeRawRecord } from "../gmail/collect.js";
import { emailLines } from "../gmail/text.js";
import { classifyWiseEmail, parseTransferSent, transferNumberFrom, type WiseTransferSent } from "./parse.js";

export { dataDir } from "../gmail/collect.js";

export const WISE_CONNECTOR = "wise";
const FILES_DIR = "wise"; // data/imports/wise/
// Transactional mail only; marketing comes from info.wise.com / info@wise.com.
const GMAIL_QUERY = 'from:noreply@wise.com subject:transfer';

export interface WiseEmailMeta {
  messageId: string | null;
  date: string | null;
  subject: string;
  emlFile: string; // relative to data/
}

export interface WiseTransferPayload {
  transfer: WiseTransferSent;
  email: WiseEmailMeta;
}

export interface WiseProblemPayload {
  transferNumber: string;
  summary: string; // first sentences of the email, for display
  email: WiseEmailMeta;
}

export interface WiseSyncResult {
  source: "gmail" | "folder";
  mode: "full" | "incremental";
  emailsSeen: number;
  transfers: { inserted: number; updated: number; unchanged: number };
  problems: { inserted: number; updated: number; unchanged: number };
  unreadable: string[];
}

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

async function processEmails(jobId: string, rawEmails: Buffer[], result: WiseSyncResult) {
  const seen = new Set<string>();
  for (const raw of rawEmails) {
    for (const { raw: emlRaw, parsed } of await unpackEmail(raw)) {
      const subject = parsed.subject ?? "";
      const kind = classifyWiseEmail(fromText(parsed), subject);
      if (kind === "other") continue;

      const key = parsed.messageId ?? sha(emlRaw);
      if (seen.has(key)) continue;
      seen.add(key);
      result.emailsSeen++;

      const day = parsed.date ? parsed.date.toISOString().slice(0, 10) : "undated";
      const number = transferNumberFrom(subject)!;
      const email: WiseEmailMeta = {
        messageId: parsed.messageId ?? null,
        date: parsed.date?.toISOString() ?? null,
        subject,
        emlFile: keepFile(FILES_DIR, "emails", `${day}_${number}_${sha(emlRaw).slice(0, 10)}.eml`, emlRaw),
      };
      const lines = emailLines(parsed);

      if (kind === "transfer_sent") {
        const transfer = parseTransferSent(subject, lines.join("\n"));
        if (!transfer) {
          result.unreadable.push(`${day} "${subject}": couldn't read who was paid / how much`);
          continue;
        }
        const r = storeRawRecord(
          WISE_CONNECTOR, jobId, `transfer:${number}`, email.date, { transfer, email } satisfies WiseTransferPayload,
          (p: WiseTransferPayload) => p.transfer
        );
        result.transfers[r]++;
      } else {
        const start = lines.findIndex((l) => /^hello\b/i.test(l));
        const summary = lines.slice(start + 1, start + 4).join(" ").slice(0, 400);
        const r = storeRawRecord(
          WISE_CONNECTOR, jobId, `problem:${number}:${key}`, email.date, { transferNumber: number, summary, email } satisfies WiseProblemPayload,
          (p: WiseProblemPayload) => p.summary
        );
        result.problems[r]++;
      }
    }
  }
}

function emptyResult(source: WiseSyncResult["source"], mode: WiseSyncResult["mode"]): WiseSyncResult {
  return {
    source, mode, emailsSeen: 0,
    transfers: { inserted: 0, updated: 0, unchanged: 0 },
    problems: { inserted: 0, updated: 0, unchanged: 0 },
    unreadable: [],
  };
}
const counts = (r: WiseSyncResult) => ({ imported: r.transfers.inserted + r.problems.inserted, skipped: r.transfers.unchanged + r.problems.unchanged });

export function syncWiseFromGmail({ full = false } = {}): Promise<WiseSyncResult> {
  return runSyncJob(WISE_CONNECTOR, { source: "gmail", full }, async (jobId) => {
    const { emails, mode } = await fetchFromGmail(WISE_CONNECTOR, GMAIL_QUERY, { full });
    const result = emptyResult("gmail", mode);
    await processEmails(jobId, emails, result);
    return result;
  }, counts);
}

export function syncWiseFromFolder(folder: string): Promise<WiseSyncResult> {
  return runSyncJob(WISE_CONNECTOR, { source: "folder", folder }, async (jobId) => {
    const result = emptyResult("folder", "full");
    await processEmails(jobId, readEmlFolder(folder), result);
    return result;
  }, counts);
}

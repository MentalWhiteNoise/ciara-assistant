// IngramSpark "sync": collect Ingram emails and store what's in them as raw records.
//
// Sources:
//   • the shared reports inbox (Gmail, opened READ-ONLY — see gmail/client.ts)
//   • a local folder of saved .eml files (used for dry runs and backfills, so
//     testing never needs to touch Gmail)
//
// Each email is unpacked (backlog emails arrive as .eml attachments inside one
// forwarded email), classified, and:
//   • AR invoice emails → one raw record per invoice ("invoice:<number>"),
//     plus the invoice PDF and the original .eml kept under data/imports/ingram/
//   • payment confirmations → one raw record ("payment:<date>:<invoices>")
//
// Nothing here creates transactions — that's import.ts, working from the raw
// records. Keeping the original email means the parser can be improved later
// without downloading anything again.

import { createHash } from "node:crypto";
import { fromText, isEmlAttachment, unpackEmail } from "../gmail/unpack.js";
import { fetchFromGmail, keepFile, readEmlFolder, runSyncJob, storeRawRecord } from "../gmail/collect.js";
import { classifyIngramEmail, parseInvoiceTsv, parsePaymentConfirmation, type IngramInvoice, type PaymentConfirmation } from "./parse.js";

export { dataDir } from "../gmail/collect.js";

export const INGRAM_CONNECTOR = "ingramspark";
const FILES_DIR = "ingram"; // data/imports/ingram/

/** Ingram's billing senders. */
const GMAIL_QUERY = "from:AR_Invoices.US@IngramContent.com OR from:IngramSparkCredit@ingramcontent.com";

export interface EmailMeta {
  messageId: string | null;
  date: string | null;
  from: string;
  subject: string;
  emlFile: string; // relative to data/
}

export interface InvoiceRawPayload {
  invoice: IngramInvoice;
  email: EmailMeta;
  pdfFile: string | null; // relative to data/
}

export interface PaymentRawPayload {
  confirmation: PaymentConfirmation;
  email: EmailMeta;
}

export interface IngramSyncResult {
  source: "gmail" | "folder";
  mode: "full" | "incremental";
  emailsSeen: number;
  invoiceEmails: number;
  paymentEmails: number;
  invoices: { inserted: number; updated: number; unchanged: number };
  payments: { inserted: number; updated: number; unchanged: number };
  problems: string[];
}

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** Process raw .eml buffers (each may contain attached emails). */
async function processEmails(jobId: string, rawEmails: Buffer[], result: IngramSyncResult) {
  const seen = new Set<string>();
  for (const raw of rawEmails) {
    for (const { raw: emlRaw, parsed } of await unpackEmail(raw)) {
      const from = fromText(parsed);
      const subject = parsed.subject ?? "";
      const kind = classifyIngramEmail(from, subject);
      if (kind === "other") continue;

      const key = parsed.messageId ?? sha(emlRaw);
      if (seen.has(key)) continue;
      seen.add(key);
      result.emailsSeen++;

      const day = parsed.date ? parsed.date.toISOString().slice(0, 10) : "undated";
      const hash = sha(emlRaw).slice(0, 10);
      const email: EmailMeta = {
        messageId: parsed.messageId ?? null,
        date: parsed.date?.toISOString() ?? null,
        from,
        subject,
        emlFile: keepFile(FILES_DIR, "emails", `${day}_${hash}.eml`, emlRaw),
      };

      if (kind === "invoice") {
        result.invoiceEmails++;
        const files = parsed.attachments.filter((a) => !isEmlAttachment(a));
        const tsv = files.find((a) => /\.xls$/i.test(a.filename ?? ""));
        const pdf = files.find((a) => /\.pdf$/i.test(a.filename ?? ""));
        if (!tsv) {
          result.problems.push(`${day} "${subject}": no invoice.xls attached`);
          continue;
        }
        let invoices: IngramInvoice[];
        try {
          invoices = parseInvoiceTsv(tsv.content.toString("utf8"));
        } catch (err) {
          result.problems.push(`${day} "${subject}": ${(err as Error).message}`);
          continue;
        }
        const pdfFile = pdf ? keepFile(FILES_DIR, "invoices", `${day}_${hash}.pdf`, pdf.content) : null;
        for (const invoice of invoices) {
          const r = storeRawRecord(
            INGRAM_CONNECTOR, jobId, `invoice:${invoice.invoiceNumber}`, invoice.invoiceDate,
            { invoice, email, pdfFile } satisfies InvoiceRawPayload,
            (p: InvoiceRawPayload) => p.invoice // same invoice found via another email ≠ a change
          );
          result.invoices[r]++;
        }
      } else {
        result.paymentEmails++;
        const confirmation = parsePaymentConfirmation(parsed.text ?? "");
        if (!confirmation) {
          result.problems.push(`${day} "${subject}": couldn't read the payment confirmation`);
          continue;
        }
        const ids = confirmation.invoices.map((i) => i.invoiceNumber).sort().join(",");
        const r = storeRawRecord(
          INGRAM_CONNECTOR, jobId, `payment:${confirmation.chargedOn}:${ids}`, confirmation.chargedOn,
          { confirmation, email } satisfies PaymentRawPayload,
          (p: PaymentRawPayload) => p.confirmation
        );
        result.payments[r]++;
      }
    }
  }
}

function emptyResult(source: IngramSyncResult["source"], mode: IngramSyncResult["mode"]): IngramSyncResult {
  return {
    source, mode, emailsSeen: 0, invoiceEmails: 0, paymentEmails: 0,
    invoices: { inserted: 0, updated: 0, unchanged: 0 },
    payments: { inserted: 0, updated: 0, unchanged: 0 },
    problems: [],
  };
}

const counts = (r: IngramSyncResult) => ({
  imported: r.invoices.inserted + r.payments.inserted,
  skipped: r.invoices.unchanged + r.payments.unchanged,
});

/**
 * Read Ingram emails from the shared inbox (read-only). Incremental by default:
 * only mail newer than the last successful run (minus a week of overlap).
 */
export function syncIngramFromGmail({ full = false } = {}): Promise<IngramSyncResult> {
  return runSyncJob(INGRAM_CONNECTOR, { source: "gmail", full }, async (jobId) => {
    const { emails, mode } = await fetchFromGmail(INGRAM_CONNECTOR, GMAIL_QUERY, { full });
    const result = emptyResult("gmail", mode);
    await processEmails(jobId, emails, result);
    return result;
  }, counts);
}

/** Same processing from a folder of .eml files (searched recursively). No network. */
export function syncIngramFromFolder(folder: string): Promise<IngramSyncResult> {
  return runSyncJob(INGRAM_CONNECTOR, { source: "folder", folder }, async (jobId) => {
    const result = emptyResult("folder", "full");
    await processEmails(jobId, readEmlFolder(folder), result);
    return result;
  }, counts);
}

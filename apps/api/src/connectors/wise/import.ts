// Turns stored Wise transfer emails (raw records from sync.ts) into transactions.
//
//   previewWiseImport() — plans everything, writes NOTHING
//   runWiseImport()     — same plan, written in ONE database transaction
//
// Wise is used mainly to pay other artists (commissioned art for marketing or
// for the books). Each "Transfer sent" becomes:
//   • an expense to the recipient. The FIRST payment to someone goes to the
//     Review page ("needs review", grouped by payee) — the owner picks the
//     category (e.g. Commissioned Art) once and can tick "remember". After
//     that, the payee rule categorises later payments automatically.
//   • a fee expense ("PayPal & Processing Fees"), linked to it, when the Wise
//     fee isn't zero. Fees skip payee review (see the fee insert below).
// The "Transfer sent" email is attached as the receipt.
//
// import_dedup_log ("wise", "transfer:<number>" / "fee:<number>") guarantees
// each transfer is imported once — including later from the Wise API, which
// uses the same transfer numbers.

import fs from "node:fs";
import { ulid } from "ulid";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { categories, importDedupLog, importRawRecords, payeeRules, transactions } from "../../db/schema/index.js";
import { attachFile } from "../purchases.js";
import { WISE_CONNECTOR, dataDir, type WiseProblemPayload, type WiseTransferPayload } from "./sync.js";

const FEE_CATEGORY = "PayPal & Processing Fees";
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Calendar date in the owner's time zone (Ohio). */
function localDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(iso));
}

/** Stable payee key for rules: Wise emails give a name, not an account ID. */
export const wiseCounterpartyId = (recipient: string) => `name:${recipient.trim().toLowerCase().replace(/\s+/g, " ")}`;

export interface PlannedWiseTransfer {
  transferNumber: string;
  date: string;
  recipient: string;
  amount: number;
  currency: string;
  fee: number;
  /** "needs_review" unless a remembered payee rule decides it. */
  status: "needs_review" | "confirmed" | "personal";
  category: string | null;
}

export interface WiseImportSummary {
  toImport: PlannedWiseTransfer[];
  alreadyImported: number;
  /** Transfers Wise paused, with no "Transfer sent" email for that number. */
  unresolvedProblems: { transferNumber: string; date: string | null; summary: string }[];
  totals: { transfers: number; amount: number; fees: number; needsReview: number };
}

function plan() {
  const raw = db
    .select({ id: importRawRecords.id, externalId: importRawRecords.externalId, payload: importRawRecords.payload })
    .from(importRawRecords)
    .where(eq(importRawRecords.connector, WISE_CONNECTOR))
    .all();
  const sent = raw.filter((r) => r.externalId.startsWith("transfer:"))
    .map((r) => ({ rawId: r.id, p: JSON.parse(r.payload) as WiseTransferPayload }));
  const problems = raw.filter((r) => r.externalId.startsWith("problem:"))
    .map((r) => JSON.parse(r.payload) as WiseProblemPayload);

  const rules = new Map(
    db.select().from(payeeRules).where(eq(payeeRules.connector, WISE_CONNECTOR)).all().map((r) => [r.counterpartyId, r])
  );
  const categoryName = new Map(db.select({ id: categories.id, name: categories.name }).from(categories).all().map((c) => [c.id, c.name]));

  const summary: WiseImportSummary = {
    toImport: [], alreadyImported: 0, unresolvedProblems: [],
    totals: { transfers: 0, amount: 0, fees: 0, needsReview: 0 },
  };
  const planned: { rawId: string; p: WiseTransferPayload; plan: PlannedWiseTransfer; categoryId: string | null }[] = [];

  const sentNumbers = new Set(sent.map((s) => s.p.transfer.transferNumber));
  for (const pr of problems) {
    if (!sentNumbers.has(pr.transferNumber)) {
      summary.unresolvedProblems.push({ transferNumber: pr.transferNumber, date: pr.email.date, summary: pr.summary });
    }
  }

  for (const { rawId, p } of sent) {
    const t = p.transfer;
    const logged = db.select({ id: importDedupLog.transactionId }).from(importDedupLog)
      .where(and(eq(importDedupLog.connector, WISE_CONNECTOR), eq(importDedupLog.externalId, `transfer:${t.transferNumber}`))).get();
    if (logged) {
      summary.alreadyImported++;
      continue;
    }
    const rule = rules.get(wiseCounterpartyId(t.recipient));
    const status: PlannedWiseTransfer["status"] = !rule ? "needs_review" : rule.action === "personal" ? "personal" : "confirmed";
    const categoryId = rule?.action === "business" ? rule.categoryId ?? null : null;
    const pl: PlannedWiseTransfer = {
      transferNumber: t.transferNumber,
      date: localDate(p.email.date!),
      recipient: t.recipient,
      amount: t.amount,
      currency: t.currency,
      fee: t.fee,
      status,
      category: categoryId ? categoryName.get(categoryId) ?? null : null,
    };
    summary.toImport.push(pl);
    planned.push({ rawId, p, plan: pl, categoryId });
    summary.totals.transfers++;
    summary.totals.amount = round2(summary.totals.amount + t.amount);
    summary.totals.fees = round2(summary.totals.fees + t.fee);
    if (status === "needs_review") summary.totals.needsReview++;
  }
  summary.toImport.sort((a, b) => a.date.localeCompare(b.date));
  return { summary, planned };
}

export function previewWiseImport(): WiseImportSummary {
  return plan().summary;
}

export function runWiseImport(): WiseImportSummary {
  const { summary, planned } = plan();
  if (planned.length === 0) return summary;
  const now = new Date().toISOString();
  const feeCategoryId = db.select({ id: categories.id }).from(categories).where(eq(categories.name, FEE_CATEGORY)).get()?.id ?? null;
  const copiedFiles: string[] = [];

  try {
    db.transaction((tx) => {
      for (const { rawId, p, plan: pl, categoryId } of planned) {
        const t = p.transfer;
        const counterpartyId = wiseCounterpartyId(t.recipient);
        const transactionId = ulid();
        tx.insert(transactions).values({
          id: transactionId,
          type: "expense",
          amount: round2(t.amount),
          currency: t.currency,
          description: `Wise transfer to ${t.recipient}`,
          categoryId,
          payee: t.recipient,
          paymentMethod: "bank_transfer",
          referenceId: t.transferNumber,
          source: WISE_CONNECTOR,
          notes: `Wise transfer #${t.transferNumber}: ${t.amount.toFixed(2)} ${t.currency} to ${t.recipient}, Wise fee ${t.fee.toFixed(2)} ${t.feeCurrency}.`,
          isTaxDeductible: pl.status === "confirmed",
          occurredAt: pl.date,
          reviewStatus: pl.status,
          counterpartyId,
          importedAt: now,
        }).run();
        tx.insert(importDedupLog).values({ connector: WISE_CONNECTOR, externalId: `transfer:${t.transferNumber}`, transactionId }).run();

        if (t.fee > 0) {
          const feeId = ulid();
          tx.insert(transactions).values({
            id: feeId,
            type: "expense",
            amount: round2(t.fee),
            currency: t.feeCurrency,
            description: `Wise fee — transfer to ${t.recipient}`,
            categoryId: feeCategoryId,
            payee: "Wise",
            paymentMethod: "bank_transfer",
            referenceId: t.transferNumber,
            source: WISE_CONNECTOR,
            isTaxDeductible: pl.status !== "personal",
            occurredAt: pl.date,
            // Fees are never sent to payee review: they share the artist's
            // payee, and "remember" on the Review page would give the fee the
            // artist's category. A fee is a processing fee, linked to its
            // payment (and personal only if a rule already says the payee is).
            reviewStatus: pl.status === "personal" ? "personal" : "confirmed",
            relatedTransactionId: transactionId,
            counterpartyId: null,
            importedAt: now,
          }).run();
          tx.insert(importDedupLog).values({ connector: WISE_CONNECTOR, externalId: `fee:${t.transferNumber}`, transactionId: feeId }).run();
        }

        const copied = attachFile(tx, {
          dataDir,
          sourceRelPath: p.email.emlFile,
          transactionId,
          fileType: "receipt",
          originalName: `Wise transfer ${t.transferNumber}.eml`,
          mimeType: "message/rfc822",
        });
        if (copied) copiedFiles.push(copied);
        tx.update(importRawRecords).set({ normalizedAt: now }).where(eq(importRawRecords.id, rawId)).run();
      }
    });
  } catch (err) {
    for (const f of copiedFiles) fs.rmSync(f, { force: true });
    throw err;
  }
  return summary;
}

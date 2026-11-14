// IngramSpark routes. IngramSpark has no API; its emails are read from the
// shared reports inbox (Gmail, read-only).
//
//   GET  /api/ingram/status   — imported invoices, last inbox check, anything waiting
//   POST /api/ingram/check    { full?: boolean }
//        Check the inbox now and import new invoices (the same thing the
//        automatic 6-hourly check does). full=true re-reads all Ingram mail
//        instead of just mail since the last check.
// The read-only inbox scan (diagnostic) is generic: POST /api/inbox/scan (routes/inbox.ts).

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { importRawRecords, syncJobs, transactions } from "../db/schema/index.js";
import { isUnlocked, getSecret } from "../vault/vault.js";
import { GmailError } from "../connectors/gmail/client.js";
import { INGRAM_CONNECTOR, type PaymentRawPayload } from "../connectors/ingramspark/sync.js";
import { previewIngramImport } from "../connectors/ingramspark/import.js";
import { checkInboxNow, isInboxCheckRunning } from "../connectors/gmail/auto.js";

const CheckSchema = z.object({ full: z.boolean().optional() });

export async function ingramRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  const gmailProblem = () => {
    if (!isUnlocked()) return { code: 423, error: "Vault is locked — unlock it in Settings → Integrations" };
    if (!getSecret("gmail")) return { code: 400, error: "Set up the Reports inbox in Settings → Integrations first" };
    return null;
  };

  app.get("/ingram/status", async () => {
    const invoices = db
      .select({
        id: transactions.id,
        occurredAt: transactions.occurredAt,
        amount: transactions.amount,
        description: transactions.description,
        referenceId: transactions.referenceId,
      })
      .from(transactions)
      .where(eq(transactions.source, INGRAM_CONNECTOR))
      .orderBy(desc(transactions.occurredAt))
      .all();

    const lastCheck = db
      .select({ startedAt: syncJobs.startedAt, completedAt: syncJobs.completedAt, status: syncJobs.status, errorMessage: syncJobs.errorMessage, config: syncJobs.config })
      .from(syncJobs)
      .where(eq(syncJobs.connector, INGRAM_CONNECTOR))
      .orderBy(desc(syncJobs.createdAt))
      .all()
      .find((j) => j.config && JSON.parse(j.config).source === "gmail");

    const payments = db
      .select({ payload: importRawRecords.payload })
      .from(importRawRecords)
      .where(and(eq(importRawRecords.connector, INGRAM_CONNECTOR)))
      .all()
      .map((r) => JSON.parse(r.payload) as Partial<PaymentRawPayload>)
      .filter((p) => p.confirmation)
      .map((p) => p.confirmation!);

    return {
      gmailReady: gmailProblem() === null,
      checking: isInboxCheckRunning(INGRAM_CONNECTOR),
      lastCheck: lastCheck
        ? {
            startedAt: lastCheck.startedAt,
            status: lastCheck.status,
            error: lastCheck.errorMessage,
            problems: (JSON.parse(lastCheck.config ?? "{}").result?.problems ?? []) as string[],
          }
        : null,
      invoices,
      waiting: previewIngramImport().totals.invoices,
      payments,
    };
  });

  app.post("/ingram/check", async (req, reply) => {
    const body = CheckSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "Invalid request" });
    const problem = gmailProblem();
    if (problem) return reply.code(problem.code).send({ error: problem.error });
    try {
      return await checkInboxNow(INGRAM_CONNECTOR, { full: body.data.full ?? false });
    } catch (err) {
      if (err instanceof GmailError) return reply.code(502).send({ error: err.message });
      if (/already running/.test((err as Error).message)) return reply.code(409).send({ error: (err as Error).message });
      throw err;
    }
  });

}

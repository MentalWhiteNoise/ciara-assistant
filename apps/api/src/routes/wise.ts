// Wise routes (email stage — the read-only Wise API comes later).
//
//   GET  /api/wise/status  — imported transfers, last inbox check, paused transfers
//   POST /api/wise/check   { full?: boolean }
//        Check the inbox now and import "Transfer sent" emails (the same thing
//        the automatic 6-hourly check does).

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { categories, syncJobs, transactions } from "../db/schema/index.js";
import { getSecret, isUnlocked } from "../vault/vault.js";
import { GmailError } from "../connectors/gmail/client.js";
import { checkInboxNow, isInboxCheckRunning } from "../connectors/gmail/auto.js";
import { WISE_CONNECTOR } from "../connectors/wise/sync.js";
import { previewWiseImport } from "../connectors/wise/import.js";

const CheckSchema = z.object({ full: z.boolean().optional() });

export async function wiseRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  const gmailProblem = () => {
    if (!isUnlocked()) return { code: 423, error: "Vault is locked — unlock it in Settings → Integrations" };
    if (!getSecret("gmail")) return { code: 400, error: "Set up the Reports inbox in Settings → Integrations first" };
    return null;
  };

  app.get("/wise/status", async () => {
    // Payments only (fees are linked rows with relatedTransactionId set).
    const transfers = db
      .select({
        id: transactions.id,
        occurredAt: transactions.occurredAt,
        amount: transactions.amount,
        currency: transactions.currency,
        payee: transactions.payee,
        referenceId: transactions.referenceId,
        reviewStatus: transactions.reviewStatus,
        category: categories.name,
      })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(and(eq(transactions.source, WISE_CONNECTOR), isNull(transactions.relatedTransactionId)))
      .orderBy(desc(transactions.occurredAt))
      .all();

    const lastCheck = db
      .select({ startedAt: syncJobs.startedAt, status: syncJobs.status, errorMessage: syncJobs.errorMessage, config: syncJobs.config })
      .from(syncJobs)
      .where(eq(syncJobs.connector, WISE_CONNECTOR))
      .orderBy(desc(syncJobs.createdAt))
      .all()
      .find((j) => j.config && JSON.parse(j.config).source === "gmail");

    const preview = previewWiseImport();
    return {
      gmailReady: gmailProblem() === null,
      checking: isInboxCheckRunning(WISE_CONNECTOR),
      lastCheck: lastCheck
        ? {
            startedAt: lastCheck.startedAt,
            status: lastCheck.status,
            error: lastCheck.errorMessage,
            problems: (JSON.parse(lastCheck.config ?? "{}").result?.unreadable ?? []) as string[],
          }
        : null,
      transfers,
      readyToImport: preview.totals.transfers,
      pausedTransfers: preview.unresolvedProblems,
    };
  });

  app.post("/wise/check", async (req, reply) => {
    const body = CheckSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "Invalid request" });
    const problem = gmailProblem();
    if (problem) return reply.code(problem.code).send({ error: problem.error });
    try {
      return await checkInboxNow(WISE_CONNECTOR, { full: body.data.full ?? false });
    } catch (err) {
      if (err instanceof GmailError) return reply.code(502).send({ error: err.message });
      if (/already running/.test((err as Error).message)) return reply.code(409).send({ error: (err as Error).message });
      throw err;
    }
  });
}

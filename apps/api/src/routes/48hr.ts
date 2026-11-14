// 48HR Books routes. 48HR has no API; its emails are read from the shared
// reports inbox (Gmail, read-only).
//
//   GET  /api/48hr/status  — imported orders, last inbox check, orders waiting
//   POST /api/48hr/check   { full?: boolean }
//        Check the inbox now and import paid orders (the same thing the
//        automatic 6-hourly check does).

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { syncJobs, transactions } from "../db/schema/index.js";
import { getSecret, isUnlocked } from "../vault/vault.js";
import { GmailError } from "../connectors/gmail/client.js";
import { checkInboxNow, isInboxCheckRunning } from "../connectors/gmail/auto.js";
import { FORTY_EIGHT_CONNECTOR } from "../connectors/48hr/sync.js";
import { preview48HrImport } from "../connectors/48hr/import.js";

const CheckSchema = z.object({ full: z.boolean().optional() });

export async function fortyEightRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  const gmailProblem = () => {
    if (!isUnlocked()) return { code: 423, error: "Vault is locked — unlock it in Settings → Integrations" };
    if (!getSecret("gmail")) return { code: 400, error: "Set up the Reports inbox in Settings → Integrations first" };
    return null;
  };

  app.get("/48hr/status", async () => {
    const orders = db
      .select({
        id: transactions.id,
        occurredAt: transactions.occurredAt,
        amount: transactions.amount,
        description: transactions.description,
        referenceId: transactions.referenceId,
      })
      .from(transactions)
      .where(eq(transactions.source, FORTY_EIGHT_CONNECTOR))
      .orderBy(desc(transactions.occurredAt))
      .all();

    const lastCheck = db
      .select({ startedAt: syncJobs.startedAt, status: syncJobs.status, errorMessage: syncJobs.errorMessage, config: syncJobs.config })
      .from(syncJobs)
      .where(eq(syncJobs.connector, FORTY_EIGHT_CONNECTOR))
      .orderBy(desc(syncJobs.createdAt))
      .all()
      .find((j) => j.config && JSON.parse(j.config).source === "gmail");

    const preview = preview48HrImport();
    return {
      gmailReady: gmailProblem() === null,
      checking: isInboxCheckRunning(FORTY_EIGHT_CONNECTOR),
      lastCheck: lastCheck
        ? {
            startedAt: lastCheck.startedAt,
            status: lastCheck.status,
            error: lastCheck.errorMessage,
            problems: (JSON.parse(lastCheck.config ?? "{}").result?.problems ?? []) as string[],
          }
        : null,
      orders,
      readyToImport: preview.totals.orders,
      waiting: preview.waiting,
      changedAfterImport: preview.changedAfterImport,
    };
  });

  app.post("/48hr/check", async (req, reply) => {
    const body = CheckSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "Invalid request" });
    const problem = gmailProblem();
    if (problem) return reply.code(problem.code).send({ error: problem.error });
    try {
      return await checkInboxNow(FORTY_EIGHT_CONNECTOR, { full: body.data.full ?? false });
    } catch (err) {
      if (err instanceof GmailError) return reply.code(502).send({ error: err.message });
      if (/already running/.test((err as Error).message)) return reply.code(409).send({ error: (err as Error).message });
      throw err;
    }
  });
}

// Integration sync routes. All require JWT auth.
//
//   POST /api/sync/paypal       — { mode: "full" | "incremental" } → 202 { jobId }
//   POST /api/sync/squarespace  — same, for Squarespace orders/transactions/products
//   GET  /api/sync/squarespace/import — preview (writes nothing)
//   POST /api/sync/squarespace/import — create orders/transactions from downloaded records
//   GET  /api/sync/:connector   — recent jobs + how many raw records are stored
//   GET  /api/sync/paypal/import — preview: what importing would create (writes nothing)
//   POST /api/sync/paypal/import — turn downloaded records into transactions

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { count, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { importRawRecords, syncJobs } from "../db/schema/index.js";
import { getSecret, isUnlocked } from "../vault/vault.js";
import { isPayPalSyncRunning, startPayPalSync } from "../connectors/paypal/sync.js";
import { getPayPalConnectorKey } from "../connectors/paypal/client.js";
import { isSquarespaceSyncRunning, startSquarespaceSync, SQUARESPACE_CONNECTOR } from "../connectors/squarespace/sync.js";
import { previewSquarespaceImport, runSquarespaceImport } from "../connectors/squarespace/import.js";
import { countUnprocessed, previewPayPalImport, runPayPalImport } from "../connectors/paypal/import.js";

const StartSchema = z.object({ mode: z.enum(["full", "incremental"]).default("incremental") });

export async function syncRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // A job still "running" at startup was cut off by a server restart.
  db.update(syncJobs)
    .set({ status: "failed", errorMessage: "Interrupted by server restart", completedAt: new Date().toISOString() })
    .where(eq(syncJobs.status, "running"))
    .run();

  app.post("/sync/paypal", async (req, reply) => {
    const body = StartSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "Invalid mode" });
    if (!isUnlocked()) return reply.code(423).send({ error: "Vault is locked" });
    if (!getSecret("paypal")) return reply.code(400).send({ error: "PayPal isn't connected" });
    if (isPayPalSyncRunning()) return reply.code(409).send({ error: "A PayPal sync is already running" });

    const jobId = startPayPalSync(body.data.mode);
    return reply.code(202).send({ jobId });
  });

  app.post("/sync/squarespace", async (req, reply) => {
    const body = StartSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "Invalid mode" });
    if (!isUnlocked()) return reply.code(423).send({ error: "Vault is locked" });
    if (!getSecret("squarespace")) return reply.code(400).send({ error: "Squarespace isn't connected" });
    if (isSquarespaceSyncRunning()) return reply.code(409).send({ error: "A Squarespace sync is already running" });
    return reply.code(202).send({ jobId: startSquarespaceSync(body.data.mode) });
  });

  // Squarespace import works from stored records only — no vault needed.
  app.get("/sync/squarespace/import", async () => previewSquarespaceImport());

  app.post("/sync/squarespace/import", async (_req, reply) => {
    if (isSquarespaceSyncRunning()) return reply.code(409).send({ error: "Wait for the Squarespace download to finish" });
    return runSquarespaceImport();
  });

  // Static paths beat "/sync/:connector" in Fastify's router, so order doesn't matter.
  app.get("/sync/paypal/import", async (_req, reply) => {
    if (!isUnlocked() || !getSecret("paypal")) return reply.code(423).send({ error: "Vault is locked or PayPal isn't connected" });
    const connector = getPayPalConnectorKey();
    return { unprocessed: countUnprocessed(connector), preview: previewPayPalImport(connector) };
  });

  app.post("/sync/paypal/import", async (_req, reply) => {
    if (!isUnlocked() || !getSecret("paypal")) return reply.code(423).send({ error: "Vault is locked or PayPal isn't connected" });
    if (isPayPalSyncRunning()) return reply.code(409).send({ error: "Wait for the PayPal download to finish" });
    return runPayPalImport(getPayPalConnectorKey());
  });

  app.get<{ Params: { connector: string } }>("/sync/:connector", async (req) => {
    // "paypal" means "whichever environment is currently saved".
    let { connector } = req.params;
    if (connector === "paypal" && isUnlocked() && getSecret("paypal")) connector = getPayPalConnectorKey();
    const jobs = db
      .select()
      .from(syncJobs)
      .where(eq(syncJobs.connector, connector))
      .orderBy(desc(syncJobs.createdAt), desc(syncJobs.id))
      .limit(5)
      .all()
      .map((j) => ({ ...j, config: j.config ? JSON.parse(j.config) : null }));
    const raw = db
      .select({ n: count() })
      .from(importRawRecords)
      .where(eq(importRawRecords.connector, connector))
      .get();
    // Squarespace stores several record kinds ("order:…", "transaction:…") — break the count down.
    let rawByKind: Record<string, number> | undefined;
    if (connector === SQUARESPACE_CONNECTOR) {
      const kind = sql<string>`substr(${importRawRecords.externalId}, 1, instr(${importRawRecords.externalId}, ':') - 1)`;
      rawByKind = Object.fromEntries(
        db.select({ kind, n: count() })
          .from(importRawRecords)
          .where(eq(importRawRecords.connector, connector))
          .groupBy(kind)
          .all()
          .map((r) => [r.kind, r.n])
      );
    }
    return { jobs, rawRecordCount: raw?.n ?? 0, rawByKind };
  });
}

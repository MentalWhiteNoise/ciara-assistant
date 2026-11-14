// Shared reports inbox routes.
//
//   POST /api/inbox/scan  { service: "ingramspark" | "48hr_books", save?: boolean }
//     Read-only inventory of one service's emails in the reports inbox,
//     including emails forwarded as .eml attachments (connectors/gmail/scan.ts).
//     save=true also copies that service's emails (only) to
//     data/imports/<service>/inbox/. Nothing is imported.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getSecret, isUnlocked } from "../vault/vault.js";
import { GmailError } from "../connectors/gmail/client.js";
import { SCAN_SERVICES, scanInbox, type ScanService } from "../connectors/gmail/scan.js";

const ScanSchema = z.object({
  service: z.enum(Object.keys(SCAN_SERVICES) as [ScanService, ...ScanService[]]),
  save: z.boolean().optional(),
});

export async function inboxRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.post("/inbox/scan", async (req, reply) => {
    const body = ScanSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "Unknown service" });
    if (!isUnlocked()) return reply.code(423).send({ error: "Vault is locked — unlock it in Settings → Integrations" });
    if (!getSecret("gmail")) return reply.code(400).send({ error: "Set up the Reports inbox in Settings → Integrations first" });
    try {
      return await scanInbox(body.data.service, { save: body.data.save ?? false });
    } catch (err) {
      if (err instanceof GmailError) return reply.code(502).send({ error: err.message });
      throw err;
    }
  });
}

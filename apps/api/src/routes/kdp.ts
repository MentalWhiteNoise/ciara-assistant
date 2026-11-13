// Amazon KDP report import routes.
//
//   GET  /api/kdp/status   — what's due, statement coverage grid, recent imports, monthly totals
//   POST /api/kdp/import   — upload one or more KDP .xlsx reports (multipart/form-data)
//
// Report detection, parsing and the reminder schedule live in connectors/kdp/.

import type { FastifyInstance } from "fastify";
import { getKdpStatus, refreshKdpReminders } from "../connectors/kdp/schedule.js";
import {
  getMonthlySummary,
  getRecentImports,
  importKdpFile,
  type ImportResult,
} from "../connectors/kdp/importer.js";

const MAX_FILES = 60; // enough to backfill several years of statements in one go

export async function kdpRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/kdp/status", async () => ({
    status: getKdpStatus(),
    months: getMonthlySummary(),
    imports: getRecentImports(),
  }));

  app.post("/kdp/import", async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({ error: "Upload the KDP report file(s) as multipart/form-data." });
    }

    const results: ImportResult[] = [];
    const parts = request.files({ limits: { fileSize: 10 * 1024 * 1024, files: MAX_FILES } });
    for await (const part of parts) {
      const name = part.filename || "report.xlsx";
      if (!/\.xlsx$/i.test(name)) {
        await part.toBuffer(); // drain the stream
        results.push({
          fileName: name,
          ok: false,
          warnings: [],
          error: "Only the .xlsx files KDP gives you can be imported here.",
        });
        continue;
      }
      const buffer = await part.toBuffer();
      try {
        results.push(importKdpFile(name, buffer));
      } catch (err) {
        request.log.error(err, "KDP import failed");
        results.push({ fileName: name, ok: false, warnings: [], error: (err as Error).message });
      }
    }

    if (results.length === 0) return reply.code(400).send({ error: "No file uploaded." });

    // Statements are often uploaded oldest-to-newest in a batch; re-run reminders
    // once at the end so the backfill task sees everything.
    refreshKdpReminders();
    return { results };
  });
}

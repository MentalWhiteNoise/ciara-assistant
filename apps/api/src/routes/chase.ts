// Chase credit card routes.
//
//   GET  /api/chase/status   — months covered, uploads, what's imported, and a preview of the next import
//   POST /api/chase/upload   — upload "Download account activity" CSV file(s) (multipart/form-data).
//                              Stores the rows only; nothing becomes a transaction yet.
//   POST /api/chase/import   — turn stored rows into transactions (the preview shown on the page)
//
// Overlapping or repeated downloads are fine: each row is stored once (see connectors/chase/parse.ts).

import type { FastifyInstance } from "fastify";
import { getChaseStatus, runChaseImport, storeChaseCsv, type ChaseUploadResult } from "../connectors/chase/import.js";

const MAX_FILES = 40;

export async function chaseRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/chase/status", async () => getChaseStatus());

  app.post("/chase/upload", async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({ error: "Upload the Chase activity file(s) as multipart/form-data." });
    }
    const results: ChaseUploadResult[] = [];
    for await (const part of request.files({ limits: { fileSize: 10 * 1024 * 1024, files: MAX_FILES } })) {
      const name = part.filename || "activity.csv";
      const buffer = await part.toBuffer();
      if (/\.pdf$/i.test(name)) {
        results.push({ fileName: name, ok: false, error: "PDF statements aren't readable yet — coming next. Use the CSV download for now." });
        continue;
      }
      if (!/\.csv$/i.test(name)) {
        results.push({ fileName: name, ok: false, error: "Only Chase's CSV activity download can be uploaded here." });
        continue;
      }
      try {
        results.push(storeChaseCsv(name, buffer.toString("utf8")));
      } catch (err) {
        request.log.error(err, "Chase upload failed");
        results.push({ fileName: name, ok: false, error: (err as Error).message });
      }
    }
    if (results.length === 0) return reply.code(400).send({ error: "No file uploaded." });
    return { results };
  });

  app.post("/chase/import", async () => runChaseImport());
}

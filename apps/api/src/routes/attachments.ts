// Attachment routes — upload, serve, and delete files linked to transactions.
//
//   GET    /api/transactions/:txId/attachments   — list attachments for a transaction
//   POST   /api/transactions/:txId/attachments   — upload a file (multipart/form-data)
//   GET    /api/attachments/:id/file             — stream the raw file to the browser
//   DELETE /api/attachments/:id                  — delete file on disk + DB row

import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import { db } from "../db/client.js";
import { attachments, transactions } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import path from "path";
import { fileURLToPath } from "url";
import {
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
  createReadStream,
} from "fs";

// data/attachments/ — two levels above apps/api/src/routes/
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../../../../data");
const attachmentsDir = path.join(dataDir, "attachments");

export async function attachmentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // ── GET /api/transactions/:txId/attachments ─────────────────────────────────
  app.get("/transactions/:txId/attachments", async (request, reply) => {
    const { txId } = request.params as { txId: string };

    const tx = db.select().from(transactions).where(eq(transactions.id, txId)).get();
    if (!tx) return reply.code(404).send({ error: "Transaction not found" });

    const rows = db
      .select()
      .from(attachments)
      .where(eq(attachments.transactionId, txId))
      .all();
    return rows;
  });

  // ── POST /api/transactions/:txId/attachments ────────────────────────────────
  // Accepts a single file via multipart/form-data (any field name).
  // Saves to data/attachments/{ulid}{ext} and records metadata in the DB.
  app.post("/transactions/:txId/attachments", async (request, reply) => {
    const { txId } = request.params as { txId: string };

    const tx = db.select().from(transactions).where(eq(transactions.id, txId)).get();
    if (!tx) return reply.code(404).send({ error: "Transaction not found" });

    const file = await request.file({ limits: { fileSize: 10 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ error: "No file uploaded" });

    mkdirSync(attachmentsDir, { recursive: true });

    const buffer = await file.toBuffer();
    const attachmentId = ulid();
    const ext = path.extname(file.filename) || "";
    const storedName = `${attachmentId}${ext}`;

    writeFileSync(path.join(attachmentsDir, storedName), buffer);

    const now = new Date().toISOString();
    db.insert(attachments)
      .values({
        id: attachmentId,
        transactionId: txId,
        filePath: storedName,          // stored name only, not full path
        fileType: "receipt",            // default; editable in the future
        originalName: file.filename,
        mimeType: file.mimetype,
        sizeBytes: buffer.length,
        createdAt: now,
      })
      .run();

    const row = db
      .select()
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .get()!;
    return reply.code(201).send(row);
  });

  // ── GET /api/attachments/:id/file ───────────────────────────────────────────
  // Streams the file to the browser. Sets Content-Type and Content-Disposition
  // so the browser can display images/PDFs inline.
  app.get("/attachments/:id/file", async (request, reply) => {
    const { id } = request.params as { id: string };

    const attachment = db
      .select()
      .from(attachments)
      .where(eq(attachments.id, id))
      .get();
    if (!attachment) return reply.code(404).send({ error: "Attachment not found" });

    const filePath = path.join(attachmentsDir, attachment.filePath);
    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: "File not found on disk" });
    }

    const stream = createReadStream(filePath);
    reply.header("Content-Type", attachment.mimeType ?? "application/octet-stream");
    reply.header(
      "Content-Disposition",
      `inline; filename="${attachment.originalName ?? attachment.filePath}"`
    );
    return reply.send(stream);
  });

  // ── DELETE /api/attachments/:id ─────────────────────────────────────────────
  app.delete("/attachments/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const attachment = db
      .select()
      .from(attachments)
      .where(eq(attachments.id, id))
      .get();
    if (!attachment) return reply.code(404).send({ error: "Attachment not found" });

    const filePath = path.join(attachmentsDir, attachment.filePath);
    try { unlinkSync(filePath); } catch { /* file already gone — still remove DB row */ }

    db.delete(attachments).where(eq(attachments.id, id)).run();
    return reply.code(204).send();
  });
}

// Transaction routes:
//   GET    /api/transactions        — paginated list with optional filters
//   POST   /api/transactions        — create a transaction
//   GET    /api/transactions/:id    — get one transaction
//   PUT    /api/transactions/:id    — update a transaction
//   DELETE /api/transactions/:id    — delete a transaction

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ulid } from "ulid";
import { db } from "../db/client.js";
import { transactions } from "../db/schema/index.js";
import { eq, desc, and, gte, lte } from "drizzle-orm";

// ── Zod schemas ────────────────────────────────────────────────────────────────

const CreateTransactionSchema = z.object({
  type: z.enum(["sale", "expense", "refund", "transfer"]),
  amount: z.number().positive("Amount must be positive"),
  currency: z.string().default("USD"),
  description: z.string().min(1, "Description is required"),
  categoryId: z.string().optional(),
  channelId: z.string().optional(),
  productId: z.string().optional(),
  payee: z.string().optional(),
  paymentMethod: z.string().optional(),
  referenceId: z.string().optional(),
  notes: z.string().optional(),
  isTaxDeductible: z.boolean().default(false),
  taxCategory: z.string().optional(),
  occurredAt: z.string().min(1, "Date is required"), // ISO date string
});

const UpdateTransactionSchema = CreateTransactionSchema.partial();

// ── Route registration ─────────────────────────────────────────────────────────

export async function transactionRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // ── GET /api/transactions ────────────────────────────────────────────────────
  // Query params:
  //   type        — "sale" | "expense" | "refund" | "transfer"
  //   from        — ISO date, start of range (inclusive)
  //   to          — ISO date, end of range (inclusive)
  //   limit       — max results (default 100)
  //   offset      — pagination offset (default 0)
  app.get("/", async (request) => {
    const {
      type,
      from,
      to,
      limit = "100",
      offset = "0",
    } = request.query as {
      type?: string;
      from?: string;
      to?: string;
      limit?: string;
      offset?: string;
    };

    const conditions = [];

    if (type) {
      conditions.push(
        eq(
          transactions.type,
          type as "sale" | "expense" | "refund" | "transfer"
        )
      );
    }
    if (from) {
      conditions.push(gte(transactions.occurredAt, from));
    }
    if (to) {
      conditions.push(lte(transactions.occurredAt, to));
    }

    const rows = db
      .select()
      .from(transactions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(transactions.occurredAt))
      .limit(parseInt(limit, 10))
      .offset(parseInt(offset, 10))
      .all();

    return rows;
  });

  // ── GET /api/transactions/:id ────────────────────────────────────────────────
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const tx = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, id))
      .get();

    if (!tx) {
      return reply.code(404).send({ error: "Transaction not found" });
    }

    return tx;
  });

  // ── POST /api/transactions ───────────────────────────────────────────────────
  app.post("/", async (request, reply) => {
    const body = CreateTransactionSchema.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    const now = new Date().toISOString();
    const id = ulid();

    db.insert(transactions)
      .values({
        id,
        ...body.data,
        source: "manual",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const tx = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, id))
      .get();

    return reply.code(201).send(tx);
  });

  // ── PUT /api/transactions/:id ────────────────────────────────────────────────
  app.put("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, id))
      .get();

    if (!existing) {
      return reply.code(404).send({ error: "Transaction not found" });
    }

    const body = UpdateTransactionSchema.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    db.update(transactions)
      .set({ ...body.data, updatedAt: new Date().toISOString() })
      .where(eq(transactions.id, id))
      .run();

    const updated = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, id))
      .get();

    return updated;
  });

  // ── DELETE /api/transactions/:id ─────────────────────────────────────────────
  // Hard delete — transactions can be truly removed (no archive needed).
  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, id))
      .get();

    if (!existing) {
      return reply.code(404).send({ error: "Transaction not found" });
    }

    db.delete(transactions).where(eq(transactions.id, id)).run();

    return reply.code(204).send();
  });
}

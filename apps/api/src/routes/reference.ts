// Reference data routes — lookups used to populate dropdowns + Settings CRUD.
//   GET    /api/categories        — all categories
//   POST   /api/categories        — create a category
//   PUT    /api/categories/:id    — update a category
//   DELETE /api/categories/:id    — delete a category
//   GET    /api/channels          — all channels (Settings shows inactive too)
//   POST   /api/channels          — create a channel
//   PUT    /api/channels/:id      — update a channel
//   DELETE /api/channels/:id      — delete a channel

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ulid } from "ulid";
import { db } from "../db/client.js";
import { categories, channels } from "../db/schema/index.js";
import { asc, eq } from "drizzle-orm";

// ── Zod schemas ────────────────────────────────────────────────────────────────

const CategorySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["income", "expense", "asset"]),
  taxLine: z.string().optional(),
  color: z.string().optional(),
});

const ChannelSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["online", "in-person", "wholesale", "distributor"]),
  isActive: z.boolean().default(true),
});

// ── Route registration ─────────────────────────────────────────────────────────

export async function referenceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // ── Categories ───────────────────────────────────────────────────────────────

  app.get("/categories", async () =>
    db.select().from(categories).orderBy(asc(categories.name)).all()
  );

  app.post("/categories", async (req, reply) => {
    const body = CategorySchema.parse(req.body);
    const id = ulid();
    db.insert(categories).values({ id, ...body }).run();
    return reply.code(201).send(
      db.select().from(categories).where(eq(categories.id, id)).get()
    );
  });

  app.put("/categories/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = CategorySchema.partial().parse(req.body);
    db.update(categories).set(body).where(eq(categories.id, id)).run();
    const row = db.select().from(categories).where(eq(categories.id, id)).get();
    if (!row) return reply.code(404).send({ error: "Not found" });
    return row;
  });

  app.delete("/categories/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    db.delete(categories).where(eq(categories.id, id)).run();
    return reply.code(204).send();
  });

  // ── Channels ─────────────────────────────────────────────────────────────────

  // GET returns ALL channels (active + inactive) so Settings can show and toggle them
  app.get("/channels", async () =>
    db.select().from(channels).orderBy(asc(channels.name)).all()
  );

  app.post("/channels", async (req, reply) => {
    const body = ChannelSchema.parse(req.body);
    const id = ulid();
    db.insert(channels).values({ id, ...body }).run();
    return reply.code(201).send(
      db.select().from(channels).where(eq(channels.id, id)).get()
    );
  });

  app.put("/channels/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = ChannelSchema.partial().parse(req.body);
    db.update(channels).set(body).where(eq(channels.id, id)).run();
    const row = db.select().from(channels).where(eq(channels.id, id)).get();
    if (!row) return reply.code(404).send({ error: "Not found" });
    return row;
  });

  app.delete("/channels/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    db.delete(channels).where(eq(channels.id, id)).run();
    return reply.code(204).send();
  });
}

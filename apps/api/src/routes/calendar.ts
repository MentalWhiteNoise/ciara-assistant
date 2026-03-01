// Calendar routes:
//   GET    /api/event-types        — list all event types (seeded reference data)
//   GET    /api/events             — list events (filter by date range)
//   POST   /api/events             — create an event
//   GET    /api/events/:id         — get one event
//   PUT    /api/events/:id         — update an event
//   DELETE /api/events/:id         — delete an event

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ulid } from "ulid";
import { db } from "../db/client.js";
import { calendarEvents, eventTypes } from "../db/schema/index.js";
import { eq, and, gte, lte, asc } from "drizzle-orm";

// ── Zod schemas ────────────────────────────────────────────────────────────────

const CreateEventSchema = z.object({
  title: z.string().min(1, "Title is required"),
  eventTypeId: z.string().optional(),
  startAt: z.string().min(1, "Start date is required"), // ISO datetime or date
  endAt: z.string().optional(),
  allDay: z.boolean().default(false),
  location: z.string().optional(),
  description: z.string().optional(),
  status: z
    .enum(["scheduled", "confirmed", "completed", "cancelled"])
    .default("scheduled"),
});

const UpdateEventSchema = CreateEventSchema.partial();

// ── Route registration ─────────────────────────────────────────────────────────

export async function calendarRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // ── GET /api/event-types ─────────────────────────────────────────────────────
  // Read-only — these are seeded; users won't add them in Phase 1.
  app.get("/event-types", async () => {
    return db.select().from(eventTypes).orderBy(asc(eventTypes.name)).all();
  });

  // ── GET /api/events ──────────────────────────────────────────────────────────
  // Query params:
  //   from   — ISO date, inclusive start of range (required for month view)
  //   to     — ISO date, inclusive end of range
  app.get("/events", async (request) => {
    const { from, to } = request.query as { from?: string; to?: string };

    const conditions = [];
    if (from) conditions.push(gte(calendarEvents.startAt, from));
    if (to) conditions.push(lte(calendarEvents.startAt, to + "T23:59:59"));

    const rows = db
      .select()
      .from(calendarEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(calendarEvents.startAt))
      .all();

    return rows;
  });

  // ── GET /api/events/:id ──────────────────────────────────────────────────────
  app.get("/events/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, id))
      .get();

    if (!event) return reply.code(404).send({ error: "Event not found" });
    return event;
  });

  // ── POST /api/events ─────────────────────────────────────────────────────────
  app.post("/events", async (request, reply) => {
    const body = CreateEventSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    const now = new Date().toISOString();
    const id = ulid();

    db.insert(calendarEvents)
      .values({
        id,
        ...body.data,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const event = db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, id))
      .get();

    return reply.code(201).send(event);
  });

  // ── PUT /api/events/:id ──────────────────────────────────────────────────────
  app.put("/events/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, id))
      .get();

    if (!existing) return reply.code(404).send({ error: "Event not found" });

    const body = UpdateEventSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    db.update(calendarEvents)
      .set({ ...body.data, updatedAt: new Date().toISOString() })
      .where(eq(calendarEvents.id, id))
      .run();

    const event = db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, id))
      .get();

    return event;
  });

  // ── DELETE /api/events/:id ───────────────────────────────────────────────────
  app.delete("/events/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, id))
      .get();

    if (!existing) return reply.code(404).send({ error: "Event not found" });

    db.delete(calendarEvents).where(eq(calendarEvents.id, id)).run();
    return reply.code(204).send();
  });
}

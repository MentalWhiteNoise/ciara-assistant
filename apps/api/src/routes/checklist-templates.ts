// Checklist template routes — reusable blueprints for creating checklists.
// A template defines a list of tasks with optional date offsets relative to today.
// When "started", a template generates a real Checklist with real task rows.
//
// These are task_templates rows where eventTypeId IS NULL.
// (Event-type templates with eventTypeId set are managed separately via calendar routes.)
//
//   GET    /api/checklist-templates        — list all standalone templates
//   POST   /api/checklist-templates        — create a template
//   PUT    /api/checklist-templates/:id    — update a template
//   DELETE /api/checklist-templates/:id    — delete a template

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ulid } from "ulid";
import { db } from "../db/client.js";
import { taskTemplates } from "../db/schema/index.js";
import { eq, isNull } from "drizzle-orm";

// ── Zod schemas ─────────────────────────────────────────────────────────────

const TemplateItemSchema = z.object({
  title: z.string().min(1, "Item title is required"),
  description: z.string().optional(),
  offsetDays: z.number().int().default(0), // days from today (negative = before, positive = after)
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
});

const CreateTemplateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  items: z.array(TemplateItemSchema).default([]),
});

const UpdateTemplateSchema = CreateTemplateSchema.partial();

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseItems(raw: string | null) {
  if (!raw) return [];
  try { return JSON.parse(raw); }
  catch { return []; }
}

function formatTemplate(row: typeof taskTemplates.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    items: parseItems(row.tasks),
    createdAt: row.createdAt,
  };
}

// ── Route registration ───────────────────────────────────────────────────────

export async function checklistTemplateRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // ── GET /api/checklist-templates ────────────────────────────────────────
  app.get("/", async () => {
    const rows = db
      .select()
      .from(taskTemplates)
      .where(isNull(taskTemplates.eventTypeId))
      .all();
    return rows.map(formatTemplate);
  });

  // ── POST /api/checklist-templates ───────────────────────────────────────
  app.post("/", async (request, reply) => {
    const body = CreateTemplateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    const { name, description, items } = body.data;
    const id = ulid();
    const now = new Date().toISOString();

    db.insert(taskTemplates)
      .values({
        id,
        name,
        description: description ?? null,
        eventTypeId: null,
        tasks: JSON.stringify(items),
        createdAt: now,
      })
      .run();

    const row = db
      .select()
      .from(taskTemplates)
      .where(eq(taskTemplates.id, id))
      .get()!;
    return reply.code(201).send(formatTemplate(row));
  });

  // ── PUT /api/checklist-templates/:id ────────────────────────────────────
  app.put("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = db
      .select()
      .from(taskTemplates)
      .where(eq(taskTemplates.id, id))
      .get();
    if (!existing) return reply.code(404).send({ error: "Template not found" });

    const body = UpdateTemplateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    const updates: Record<string, unknown> = {};
    if (body.data.name !== undefined) updates.name = body.data.name;
    if (body.data.description !== undefined) updates.description = body.data.description;
    if (body.data.items !== undefined) updates.tasks = JSON.stringify(body.data.items);

    db.update(taskTemplates).set(updates).where(eq(taskTemplates.id, id)).run();

    const row = db
      .select()
      .from(taskTemplates)
      .where(eq(taskTemplates.id, id))
      .get()!;
    return formatTemplate(row);
  });

  // ── DELETE /api/checklist-templates/:id ─────────────────────────────────
  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = db
      .select()
      .from(taskTemplates)
      .where(eq(taskTemplates.id, id))
      .get();
    if (!existing) return reply.code(404).send({ error: "Template not found" });

    db.delete(taskTemplates).where(eq(taskTemplates.id, id)).run();
    return reply.code(204).send();
  });
}

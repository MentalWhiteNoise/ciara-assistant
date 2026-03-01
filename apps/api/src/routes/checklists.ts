// Checklist routes — live checklists (named groups of tasks the user works through).
//
//   GET    /api/checklists              — list checklists with task counts
//   POST   /api/checklists              — create empty checklist
//   POST   /api/checklists/from-template — create checklist + tasks from a template
//   GET    /api/checklists/:id          — get checklist with its tasks
//   PUT    /api/checklists/:id          — update checklist header
//   DELETE /api/checklists/:id          — unlink tasks, then delete checklist

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ulid } from "ulid";
import { db } from "../db/client.js";
import { checklists, tasks, taskTemplates } from "../db/schema/index.js";
import { eq, asc } from "drizzle-orm";

// ── Zod schemas ─────────────────────────────────────────────────────────────

const CreateChecklistSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  dueDate: z.string().optional(),
});

const UpdateChecklistSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  status: z.enum(["active", "completed", "archived"]).optional(),
});

const FromTemplateSchema = z.object({
  templateId: z.string().min(1, "Template ID is required"),
  name: z.string().optional(),           // defaults to template name
  description: z.string().optional(),
  dueDate: z.string().optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTask(t: typeof tasks.$inferSelect) {
  return {
    ...t,
    tags: t.tags ? JSON.parse(t.tags as string) : [],
  };
}

// ── Route registration ───────────────────────────────────────────────────────

export async function checklistRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // ── GET /api/checklists ─────────────────────────────────────────────────
  // Returns checklists with task count + done count (not the full tasks array).
  app.get("/", async () => {
    const allChecklists = db
      .select()
      .from(checklists)
      .orderBy(asc(checklists.createdAt))
      .all();

    const allTasks = db.select().from(tasks).all();

    return allChecklists.map((cl) => {
      const clTasks = allTasks.filter((t) => t.checklistId === cl.id);
      const doneCount = clTasks.filter(
        (t) => t.status === "done" || t.status === "skipped"
      ).length;
      return {
        ...cl,
        taskCount: clTasks.length,
        doneCount,
      };
    });
  });

  // ── POST /api/checklists/from-template ──────────────────────────────────
  // Must be registered before /:id to avoid route conflict.
  app.post("/from-template", async (request, reply) => {
    const body = FromTemplateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    const { templateId, name, description, dueDate } = body.data;

    // Fetch the template
    const template = db
      .select()
      .from(taskTemplates)
      .where(eq(taskTemplates.id, templateId))
      .get();
    if (!template) {
      return reply.code(404).send({ error: "Template not found" });
    }

    // Parse template items
    let items: { title: string; description?: string; offsetDays?: number; priority?: string }[] = [];
    try {
      items = JSON.parse(template.tasks as string);
    } catch { /* malformed JSON — just create an empty checklist */ }

    const now = new Date().toISOString();
    const today = now.slice(0, 10); // "YYYY-MM-DD"

    // Create the checklist
    const checklistId = ulid();
    db.insert(checklists)
      .values({
        id: checklistId,
        name: name ?? template.name,
        description: description ?? template.description ?? null,
        dueDate: dueDate ?? null,
        status: "active",
        templateId,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Create tasks from template items, scheduling relative to today
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const taskId = ulid();
      let taskDueDate: string | null = null;

      if (item.offsetDays !== undefined) {
        const d = new Date(today + "T12:00:00");
        d.setDate(d.getDate() + item.offsetDays);
        taskDueDate = d.toISOString().slice(0, 10);
      }

      db.insert(tasks)
        .values({
          id: taskId,
          title: item.title,
          description: item.description ?? null,
          status: "todo",
          priority: (item.priority as "low" | "medium" | "high" | "urgent") ?? "medium",
          dueDate: taskDueDate,
          checklistId,
          templateId,
          sortOrder: i,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    // Return checklist with tasks
    const cl = db
      .select()
      .from(checklists)
      .where(eq(checklists.id, checklistId))
      .get()!;
    const clTasks = db
      .select()
      .from(tasks)
      .where(eq(tasks.checklistId, checklistId))
      .orderBy(asc(tasks.sortOrder))
      .all();

    return reply.code(201).send({
      ...cl,
      tasks: clTasks.map(formatTask),
    });
  });

  // ── POST /api/checklists ────────────────────────────────────────────────
  app.post("/", async (request, reply) => {
    const body = CreateChecklistSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    const now = new Date().toISOString();
    const id = ulid();

    db.insert(checklists)
      .values({
        id,
        name: body.data.name,
        description: body.data.description ?? null,
        dueDate: body.data.dueDate ?? null,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const cl = db
      .select()
      .from(checklists)
      .where(eq(checklists.id, id))
      .get()!;
    return reply.code(201).send({ ...cl, taskCount: 0, doneCount: 0 });
  });

  // ── GET /api/checklists/:id ─────────────────────────────────────────────
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const cl = db
      .select()
      .from(checklists)
      .where(eq(checklists.id, id))
      .get();
    if (!cl) return reply.code(404).send({ error: "Checklist not found" });

    const clTasks = db
      .select()
      .from(tasks)
      .where(eq(tasks.checklistId, id))
      .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))
      .all();

    return { ...cl, tasks: clTasks.map(formatTask) };
  });

  // ── PUT /api/checklists/:id ─────────────────────────────────────────────
  app.put("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = db
      .select()
      .from(checklists)
      .where(eq(checklists.id, id))
      .get();
    if (!existing) return reply.code(404).send({ error: "Checklist not found" });

    const body = UpdateChecklistSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    const updates: Record<string, unknown> = {
      ...body.data,
      updatedAt: new Date().toISOString(),
    };

    db.update(checklists).set(updates).where(eq(checklists.id, id)).run();

    const cl = db
      .select()
      .from(checklists)
      .where(eq(checklists.id, id))
      .get()!;
    return cl;
  });

  // ── DELETE /api/checklists/:id ──────────────────────────────────────────
  // Unlinks tasks (sets checklistId = null) then deletes the checklist.
  // Tasks are preserved as standalone tasks.
  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = db
      .select()
      .from(checklists)
      .where(eq(checklists.id, id))
      .get();
    if (!existing) return reply.code(404).send({ error: "Checklist not found" });

    // Unlink tasks first (avoids FK violation)
    db.update(tasks)
      .set({ checklistId: null })
      .where(eq(tasks.checklistId, id))
      .run();

    db.delete(checklists).where(eq(checklists.id, id)).run();
    return reply.code(204).send();
  });
}

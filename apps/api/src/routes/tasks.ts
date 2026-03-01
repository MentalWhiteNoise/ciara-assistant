// Task routes:
//   GET    /api/tasks        — list tasks (filter by status, date)
//   POST   /api/tasks        — create a task
//   PUT    /api/tasks/:id    — update a task (title, status, priority, dates, etc.)
//   DELETE /api/tasks/:id    — delete a task

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ulid } from "ulid";
import { db } from "../db/client.js";
import { tasks } from "../db/schema/index.js";
import { eq, and, asc, lte, gte, inArray, isNull, or } from "drizzle-orm";

// ── Zod schemas ────────────────────────────────────────────────────────────────

const TaskStatusSchema = z.enum(["todo", "in_progress", "done", "skipped"]);
const TaskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);

const CreateTaskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  status: TaskStatusSchema.default("todo"),
  priority: TaskPrioritySchema.default("medium"),
  dueDate: z.string().optional(),       // ISO date e.g. "2025-06-01"
  scheduledDate: z.string().optional(), // which day it appears on daily list
  sortOrder: z.number().int().default(0),
  tags: z.array(z.string()).optional(),
});

const UpdateTaskSchema = CreateTaskSchema.partial();

// ── Route registration ─────────────────────────────────────────────────────────

export async function taskRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // ── GET /api/tasks ───────────────────────────────────────────────────────────
  // Query params:
  //   status     — "todo" | "in_progress" | "done" | "skipped" | "active"
  //                "active" means todo + in_progress (default)
  //   date       — ISO date: returns tasks scheduled for OR due on that date
  //   from / to  — date range for scheduledDate or dueDate
  app.get("/", async (request) => {
    const { status, date } = request.query as {
      status?: string;
      date?: string;
    };

    let rows = db
      .select()
      .from(tasks)
      .orderBy(asc(tasks.sortOrder), asc(tasks.dueDate))
      .all();

    // Status filter
    if (status === "active" || !status) {
      rows = rows.filter((t) => t.status === "todo" || t.status === "in_progress");
    } else if (status === "done") {
      rows = rows.filter((t) => t.status === "done" || t.status === "skipped");
    } else if (status === "all") {
      // no filter
    } else {
      rows = rows.filter((t) => t.status === status);
    }

    // Date filter — show tasks scheduled for this date or due this date
    if (date) {
      rows = rows.filter(
        (t) => t.scheduledDate === date || t.dueDate === date
      );
    }

    // Parse tags JSON for each row
    return rows.map((t) => ({
      ...t,
      tags: t.tags ? JSON.parse(t.tags as string) : [],
    }));
  });

  // ── GET /api/tasks/:id ───────────────────────────────────────────────────────
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = db.select().from(tasks).where(eq(tasks.id, id)).get();

    if (!task) return reply.code(404).send({ error: "Task not found" });

    return {
      ...task,
      tags: task.tags ? JSON.parse(task.tags as string) : [],
    };
  });

  // ── POST /api/tasks ──────────────────────────────────────────────────────────
  app.post("/", async (request, reply) => {
    const body = CreateTaskSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    const now = new Date().toISOString();
    const id = ulid();
    const { tags, ...rest } = body.data;

    db.insert(tasks)
      .values({
        id,
        ...rest,
        tags: tags ? JSON.stringify(tags) : null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const task = db.select().from(tasks).where(eq(tasks.id, id)).get()!;
    return reply.code(201).send({
      ...task,
      tags: task.tags ? JSON.parse(task.tags as string) : [],
    });
  });

  // ── PUT /api/tasks/:id ───────────────────────────────────────────────────────
  app.put("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!existing) return reply.code(404).send({ error: "Task not found" });

    const body = UpdateTaskSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    const { tags, ...rest } = body.data;
    const updates: Record<string, unknown> = {
      ...rest,
      updatedAt: new Date().toISOString(),
    };

    if (tags !== undefined) {
      updates.tags = JSON.stringify(tags);
    }

    // If marking done, stamp completedAt
    if (body.data.status === "done" && existing.status !== "done") {
      updates.completedAt = new Date().toISOString();
    } else if (body.data.status && body.data.status !== "done") {
      updates.completedAt = null;
    }

    db.update(tasks).set(updates).where(eq(tasks.id, id)).run();

    const task = db.select().from(tasks).where(eq(tasks.id, id)).get()!;
    return {
      ...task,
      tags: task.tags ? JSON.parse(task.tags as string) : [],
    };
  });

  // ── DELETE /api/tasks/:id ────────────────────────────────────────────────────
  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!existing) return reply.code(404).send({ error: "Task not found" });

    db.delete(tasks).where(eq(tasks.id, id)).run();
    return reply.code(204).send();
  });
}

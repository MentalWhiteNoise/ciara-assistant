import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { calendarEvents, eventTypes } from "./calendar";
import { projects } from "./projects";
import { orders } from "./orders";

// Reusable task checklists attached to event types.
// When you create a "Convention" event, its task template auto-generates
// tasks offset by days relative to the event date.
export const taskTemplates = sqliteTable("task_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  eventTypeId: text("event_type_id").references(() => eventTypes.id),
  // JSON array: [{title, offsetDays, priority, description}]
  // offsetDays: negative = before event, positive = after event
  // e.g. [{title: "Order print run", offsetDays: -21, priority: "high"}]
  tasks: text("tasks").notNull(),
  description: text("description"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// A live checklist — a named group of tasks the user is actively working through.
// Can be created from a template (templateId set) or from scratch (templateId null).
export const checklists = sqliteTable("checklists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  dueDate: text("due_date"),   // ISO date — all tasks should be done by this date
  status: text("status", {
    enum: ["active", "completed", "archived"],
  })
    .notNull()
    .default("active"),
  templateId: text("template_id").references(() => taskTemplates.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", {
    enum: ["todo", "in_progress", "done", "skipped"],
  })
    .notNull()
    .default("todo"),
  priority: text("priority", {
    enum: ["low", "medium", "high", "urgent"],
  })
    .notNull()
    .default("medium"),
  dueDate: text("due_date"),        // ISO date — when it must be done
  dueTime: text("due_time"),        // HH:MM (optional)
  scheduledDate: text("scheduled_date"), // which day it appears on daily list
  // Linkages — a task can belong to an event, a project, a checklist, or be standalone
  eventId: text("event_id").references(() => calendarEvents.id),
  projectId: text("project_id").references(() => projects.id),
  checklistId: text("checklist_id").references(() => checklists.id),
  // Self-referential for subtasks
  parentTaskId: text("parent_task_id"),  // references tasks.id (no FK to avoid circular)
  templateId: text("template_id").references(() => taskTemplates.id),
  // Link to an order — set when tasks are auto-generated from an order
  orderId: text("order_id").references(() => orders.id, { onDelete: "cascade" }),
  // rrule string for recurring tasks: "FREQ=WEEKLY;BYDAY=MO"
  recurrence: text("recurrence"),
  completedAt: text("completed_at"),
  sortOrder: integer("sort_order").notNull().default(0),
  // JSON array of tag strings: ["writing", "urgent", "tax"]
  tags: text("tags"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

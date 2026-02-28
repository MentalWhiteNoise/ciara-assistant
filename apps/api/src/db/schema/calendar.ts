import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { products } from "./products";
import { projects } from "./projects";

// Templates for recurring event categories.
// e.g. "Book Launch", "Convention", "Commission", "Writing Sprint"
export const eventTypes = sqliteTable("event_types", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color"),          // hex color shown on calendar
  icon: text("icon"),
  category: text("category", {
    enum: ["writing", "editing", "marketing", "event", "admin", "commission", "other"],
  }),
  // JSON Schema defining the custom fields that events of this type capture
  // e.g. for "Convention": { venue, tableNumber, registrationCost }
  metadataSchema: text("metadata_schema"),
  // JSON array of task template objects: [{title, offsetDays, priority}]
  defaultTasks: text("default_tasks"),
  defaultDurationHours: real("default_duration_hours"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const calendarEvents = sqliteTable("calendar_events", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  eventTypeId: text("event_type_id").references(() => eventTypes.id),
  projectId: text("project_id").references(() => projects.id),
  productId: text("product_id").references(() => products.id),
  startAt: text("start_at").notNull(),       // ISO datetime
  endAt: text("end_at"),                     // ISO datetime
  allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
  location: text("location"),
  description: text("description"),
  // Custom fields defined by the event type's metadataSchema
  metadata: text("metadata"),                // JSON
  // Google Calendar sync fields
  externalId: text("external_id"),           // Google Calendar event ID
  externalCal: text("external_cal"),         // which Google Calendar it came from
  status: text("status", {
    enum: ["scheduled", "confirmed", "completed", "cancelled"],
  })
    .notNull()
    .default("scheduled"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

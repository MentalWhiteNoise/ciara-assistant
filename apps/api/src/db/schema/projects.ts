import { sqliteTable, text, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { products } from "./products";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["book", "series", "campaign", "commission_batch", "other"],
  }),
  // A project can be tied to a specific product (e.g., a book launch → the book)
  productId: text("product_id").references(() => products.id),
  status: text("status", {
    enum: ["active", "completed", "on_hold", "cancelled"],
  })
    .notNull()
    .default("active"),
  startDate: text("start_date"),
  targetDate: text("target_date"),
  completedDate: text("completed_date"),
  budget: real("budget"),    // planned spend budget
  color: text("color"),      // for UI display
  notes: text("notes"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  type: text("type", { enum: ["income", "expense", "asset"] }).notNull(),
  parentId: text("parent_id"), // self-referential, no FK declaration needed in SQLite
  taxLine: text("tax_line"),   // IRS Schedule C line: "line_8", "line_22", etc.
  color: text("color"),
  icon: text("icon"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["online", "in-person", "wholesale", "distributor"],
  }).notNull(),
  connector: text("connector"), // "amazon_kdp", "paypal", "squarespace", etc.
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  metadata: text("metadata"), // JSON
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

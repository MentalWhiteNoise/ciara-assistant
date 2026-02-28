import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  type: text("type", {
    enum: ["book", "print", "merch", "service", "commission"],
  }).notNull(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  isbn: text("isbn"),
  sku: text("sku"),
  description: text("description"),
  coverImage: text("cover_image"),
  publishedAt: text("published_at"),
  status: text("status", { enum: ["active", "archived", "draft"] })
    .notNull()
    .default("active"),
  metadata: text("metadata"), // stored as JSON string
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

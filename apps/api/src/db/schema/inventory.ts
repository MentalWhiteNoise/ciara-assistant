import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { products } from "./products";

// Current stock position per product per location.
// "location" separates home stock from distributor/consignment copies.
export const inventoryItems = sqliteTable("inventory_items", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  // Examples: "home", "ingram", "consignment:Third Place Books"
  location: text("location").notNull().default("home"),
  onHand: integer("on_hand").notNull().default(0),
  reserved: integer("reserved").notNull().default(0),  // committed, not yet shipped
  inTransit: integer("in_transit").notNull().default(0), // ordered/printing
  reorderPoint: integer("reorder_point"),               // alert threshold
  costPerUnit: real("cost_per_unit"),                   // weighted avg cost
  notes: text("notes"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Immutable audit log — every stock change appends a row here.
// Never update or delete rows; always append.
export const inventoryMovements = sqliteTable("inventory_movements", {
  id: text("id").primaryKey(),
  itemId: text("item_id")
    .notNull()
    .references(() => inventoryItems.id),
  movementType: text("movement_type", {
    enum: ["print_run", "sale", "return", "damage", "transfer", "adjustment"],
  }).notNull(),
  // Positive = stock added (print run received, return)
  // Negative = stock removed (sale, damage)
  quantity: integer("quantity").notNull(),
  unitCost: real("unit_cost"),
  // What triggered this movement
  sourceId: text("source_id"),      // FK to transaction ID or event ID
  sourceType: text("source_type", {
    enum: ["transaction", "event", "manual"],
  }),
  notes: text("notes"),
  occurredAt: text("occurred_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

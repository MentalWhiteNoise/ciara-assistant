import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { products } from "./products";

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),

  // Auto-generated for manual orders (ORD-0001), preserved for imports
  orderNumber: text("order_number").notNull(),

  // Where the order came from — manual entry or future connectors
  source: text("source", {
    enum: ["manual", "squarespace", "etsy", "shopify", "other"],
  })
    .notNull()
    .default("manual"),

  // External ID from the platform (for dedup when syncing)
  externalId: text("external_id"),

  // Order lifecycle status
  status: text("status", {
    enum: ["pending", "processing", "shipped", "delivered", "cancelled", "refunded"],
  })
    .notNull()
    .default("pending"),

  // Customer information
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),

  // Shipping address
  shipToLine1: text("ship_to_line1"),
  shipToLine2: text("ship_to_line2"),
  shipToCity: text("ship_to_city"),
  shipToState: text("ship_to_state"),
  shipToZip: text("ship_to_zip"),
  shipToCountry: text("ship_to_country"),

  // Fulfillment
  trackingNumber: text("tracking_number"),
  carrier: text("carrier"),       // USPS, UPS, FedEx, etc.

  // Financials (in USD)
  subtotal: real("subtotal").notNull().default(0),
  shippingCost: real("shipping_cost").notNull().default(0),
  taxAmount: real("tax_amount").notNull().default(0),
  total: real("total").notNull().default(0),

  // Notes / gift message / internal notes
  customerNote: text("customer_note"),
  internalNote: text("internal_note"),

  // Key dates
  orderedAt: text("ordered_at").notNull(),          // when order was placed
  dueDate: text("due_date"),                        // ship-by date (drives auto-tasks)
  shippedAt: text("shipped_at"),
  deliveredAt: text("delivered_at"),

  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const orderItems = sqliteTable("order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  // Optional link to product catalog — may be null for custom/one-off items
  productId: text("product_id").references(() => products.id),
  // Snapshot of the product title at time of order (in case product changes later)
  title: text("title").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: real("unit_price").notNull().default(0),
  // Any variant details (e.g. "Signed edition", "Size: A4")
  variant: text("variant"),
});

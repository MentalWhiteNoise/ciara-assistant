import { sqliteTable, text, real, integer, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { products } from "./products";
import { categories, channels } from "./categories";

export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  type: text("type", {
    enum: ["sale", "expense", "refund", "transfer"],
  }).notNull(),
  amount: real("amount").notNull(),           // always positive
  currency: text("currency").notNull().default("USD"),
  description: text("description").notNull(),
  categoryId: text("category_id").references(() => categories.id),
  channelId: text("channel_id").references(() => channels.id),
  productId: text("product_id").references(() => products.id),
  eventId: text("event_id"),                  // FK added when calendar schema exists
  projectId: text("project_id"),              // FK added when projects schema exists
  payee: text("payee"),
  paymentMethod: text("payment_method"),
  referenceId: text("reference_id"),          // external system's transaction ID
  source: text("source").notNull().default("manual"),
  notes: text("notes"),
  isTaxDeductible: integer("is_tax_deductible", { mode: "boolean" })
    .notNull()
    .default(false),
  taxCategory: text("tax_category"),          // IRS Schedule C line
  occurredAt: text("occurred_at").notNull(),  // ISO date
  // Imported records that might be personal start as "needs_review".
  // "personal" rows are kept (so they aren't re-imported) but excluded from reports.
  reviewStatus: text("review_status", {
    enum: ["confirmed", "needs_review", "personal"],
  })
    .notNull()
    .default("confirmed"),
  // Links a fee/transfer/refund to the sale or purchase it belongs to, so
  // they can be shown combined (net) or broken out.
  relatedTransactionId: text("related_transaction_id").references(
    (): AnySQLiteColumn => transactions.id
  ),
  // The other party's stable ID in the source system (e.g. PayPal account ID).
  // Payee rules match on this, since display names can change.
  counterpartyId: text("counterparty_id"),
  importedAt: text("imported_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id").references(() => transactions.id),
  filePath: text("file_path").notNull(),
  fileType: text("file_type", {
    enum: ["receipt", "invoice", "contract", "other"],
  }),
  originalName: text("original_name"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

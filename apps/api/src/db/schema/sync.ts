import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { transactions } from "./transactions";

// Audit log for every integration sync run.
// One row per connector per run — tells us what happened and when.
export const syncJobs = sqliteTable("sync_jobs", {
  id: text("id").primaryKey(),
  connector: text("connector").notNull(), // "paypal", "amazon_kdp", "google_calendar", etc.
  status: text("status", {
    enum: ["pending", "running", "success", "failed"],
  })
    .notNull()
    .default("pending"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  recordsImported: integer("records_imported").notNull().default(0),
  recordsSkipped: integer("records_skipped").notNull().default(0),
  errorMessage: text("error_message"),
  // JSON: date range, filters used for this run
  config: text("config"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Deduplication table — prevents importing the same external record twice.
// Before inserting a transaction, we check if (connector, externalId) already exists.
export const importDedupLog = sqliteTable(
  "import_dedup_log",
  {
    connector: text("connector").notNull(),
    externalId: text("external_id").notNull(),
    importedAt: text("imported_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    // Which local transaction this maps to (if applicable)
    transactionId: text("transaction_id").references(() => transactions.id),
  },
  // Composite primary key — prevents duplicates on (connector + externalId)
  (t) => [primaryKey({ columns: [t.connector, t.externalId] })]
);

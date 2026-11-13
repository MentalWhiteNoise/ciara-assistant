import { sqliteTable, text, integer, primaryKey, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { transactions } from "./transactions";
import { categories, channels } from "./categories";

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

// Raw records exactly as an API returned them, before we turn them into
// transactions. Keeping the original payload means we can fix or improve the
// normalizer later and re-run it WITHOUT downloading years of history again.
// One row per external record; re-fetching updates it in place (e.g. a PayPal
// payment that was "pending" and later "completed").
export const importRawRecords = sqliteTable(
  "import_raw_records",
  {
    id: text("id").primaryKey(),
    connector: text("connector").notNull(),
    externalId: text("external_id").notNull(),
    occurredAt: text("occurred_at"),          // ISO, from the record itself — for date-range queries
    payload: text("payload").notNull(),       // JSON, untouched
    syncJobId: text("sync_job_id").references(() => syncJobs.id),
    fetchedAt: text("fetched_at").notNull(),  // last time we downloaded it
    normalizedAt: text("normalized_at"),      // NULL = not yet turned into a transaction
  },
  (t) => [
    uniqueIndex("import_raw_records_connector_external_idx").on(t.connector, t.externalId),
    index("import_raw_records_occurred_idx").on(t.connector, t.occurredAt),
  ]
);

// "Always treat payments to/from this party as ..." — learned during review so
// recurring payees (subscriptions, regular suppliers) only need deciding once.
export const payeeRules = sqliteTable(
  "payee_rules",
  {
    id: text("id").primaryKey(),
    connector: text("connector").notNull(),          // "paypal"
    counterpartyId: text("counterparty_id").notNull(), // e.g. PayPal account ID
    counterpartyName: text("counterparty_name"),       // for display only
    action: text("action", { enum: ["business", "personal"] }).notNull(),
    categoryId: text("category_id").references(() => categories.id),
    channelId: text("channel_id").references(() => channels.id),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex("payee_rules_connector_party_idx").on(t.connector, t.counterpartyId)]
);

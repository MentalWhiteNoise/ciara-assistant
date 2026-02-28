import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { transactions } from "./transactions";
import { calendarEvents } from "./calendar";

// Long-term business assets — equipment, software, vehicles.
// Tracked separately from expenses because they depreciate over time.
export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),       // "MacBook Pro 14", "Epson EcoTank"
  category: text("category", {
    enum: ["equipment", "software", "vehicle", "furniture", "other"],
  }).notNull(),
  purchaseDate: text("purchase_date").notNull(),
  purchasePrice: real("purchase_price").notNull(),
  // The expense transaction that paid for this asset
  transactionId: text("transaction_id").references(() => transactions.id),
  usefulLifeYears: integer("useful_life_years"),
  depreciationMethod: text("depreciation_method", {
    enum: ["straight_line", "section_179", "bonus"],
  }).default("straight_line"),
  notes: text("notes"),
  status: text("status", {
    enum: ["active", "disposed", "sold"],
  })
    .notNull()
    .default("active"),
  disposedAt: text("disposed_at"),
  disposalValue: real("disposal_value"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// IRS standard mileage deduction tracking
export const mileageLogs = sqliteTable("mileage_logs", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  purpose: text("purpose").notNull(),   // "Drive to convention", "Office supply run"
  origin: text("origin"),
  destination: text("destination"),
  miles: real("miles").notNull(),
  // IRS standard mileage rate for the year (e.g., 0.67 for 2024)
  // Stored at time of entry so the calculation is locked in
  rate: real("rate"),
  // Optionally linked to the event this drive was for
  eventId: text("event_id").references(() => calendarEvents.id),
  notes: text("notes"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

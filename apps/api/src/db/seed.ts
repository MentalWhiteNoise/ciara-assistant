// Seed script — populates reference/lookup tables with sensible defaults.
// Safe to re-run: uses INSERT OR IGNORE so it won't create duplicates.
//
// Run with: pnpm db:seed

import { db, rawDb } from "./client.js";
import { categories, channels, eventTypes } from "./schema/index.js";
import { ulid } from "ulid";
import { sql } from "drizzle-orm";

// ── Helpers ──────────────────────────────────────────────────────────────────

function id() {
  return ulid();
}

// INSERT OR IGNORE — skip the row if the unique constraint (name) already exists
function insertOrIgnoreCategory(row: typeof categories.$inferInsert) {
  rawDb
    .prepare(
      `INSERT OR IGNORE INTO categories (id, name, type, parent_id, tax_line, color, icon)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.name,
      row.type,
      row.parentId ?? null,
      row.taxLine ?? null,
      row.color ?? null,
      row.icon ?? null
    );
}

function insertOrIgnoreChannel(row: typeof channels.$inferInsert) {
  rawDb
    .prepare(
      `INSERT OR IGNORE INTO channels (id, name, type, connector, is_active)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.name,
      row.type,
      row.connector ?? null,
      row.isActive === false ? 0 : 1
    );
}

function insertOrIgnoreEventType(row: typeof eventTypes.$inferInsert) {
  rawDb
    .prepare(
      `INSERT OR IGNORE INTO event_types (id, name, color, icon, category, default_duration_hours)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.name,
      row.color ?? null,
      row.icon ?? null,
      row.category ?? null,
      row.defaultDurationHours ?? null
    );
}

// ── IRS Schedule C Categories ─────────────────────────────────────────────────
// These are the expense/income categories that map to your annual tax return.
// "taxLine" corresponds to specific lines on IRS Schedule C.

console.log("Seeding categories (IRS Schedule C)...");

// ── Income ────────────────────────────────────────────────────────────────────
const INCOME_ID = id();
insertOrIgnoreCategory({ id: INCOME_ID, name: "Sales Income", type: "income", taxLine: "gross_receipts", color: "#22c55e" });
insertOrIgnoreCategory({ id: id(), name: "Book Sales", type: "income", parentId: INCOME_ID, taxLine: "gross_receipts", color: "#16a34a" });
insertOrIgnoreCategory({ id: id(), name: "Art & Print Sales", type: "income", parentId: INCOME_ID, taxLine: "gross_receipts", color: "#15803d" });
insertOrIgnoreCategory({ id: id(), name: "Commission Income", type: "income", parentId: INCOME_ID, taxLine: "gross_receipts", color: "#166534" });
insertOrIgnoreCategory({ id: id(), name: "Merchandise Sales", type: "income", parentId: INCOME_ID, taxLine: "gross_receipts", color: "#14532d" });
insertOrIgnoreCategory({ id: id(), name: "Event Sales", type: "income", parentId: INCOME_ID, taxLine: "gross_receipts", color: "#4ade80" });
insertOrIgnoreCategory({ id: id(), name: "Wholesale Income", type: "income", parentId: INCOME_ID, taxLine: "gross_receipts", color: "#86efac" });
insertOrIgnoreCategory({ id: id(), name: "Royalties", type: "income", taxLine: "gross_receipts", color: "#bbf7d0" });

// ── Expenses — mapped to Schedule C lines ────────────────────────────────────
// Line 8: Advertising
const ADV_ID = id();
insertOrIgnoreCategory({ id: ADV_ID, name: "Advertising & Marketing", type: "expense", taxLine: "line_8", color: "#ef4444" });
insertOrIgnoreCategory({ id: id(), name: "Social Media Ads", type: "expense", parentId: ADV_ID, taxLine: "line_8", color: "#dc2626" });
insertOrIgnoreCategory({ id: id(), name: "Print Advertising", type: "expense", parentId: ADV_ID, taxLine: "line_8", color: "#b91c1c" });
insertOrIgnoreCategory({ id: id(), name: "ARC & Review Copies", type: "expense", parentId: ADV_ID, taxLine: "line_8", color: "#991b1b" });
insertOrIgnoreCategory({ id: id(), name: "Newsletter Costs", type: "expense", parentId: ADV_ID, taxLine: "line_8", color: "#7f1d1d" });

// Line 10: Commissions & Fees
insertOrIgnoreCategory({ id: id(), name: "Platform Fees", type: "expense", taxLine: "line_10", color: "#f97316" });
insertOrIgnoreCategory({ id: id(), name: "PayPal & Processing Fees", type: "expense", taxLine: "line_10", color: "#ea580c" });

// Line 11: Contract Labor
const CONTRACT_ID = id();
insertOrIgnoreCategory({ id: CONTRACT_ID, name: "Contract Labor", type: "expense", taxLine: "line_11", color: "#a855f7" });
insertOrIgnoreCategory({ id: id(), name: "Editing Services", type: "expense", parentId: CONTRACT_ID, taxLine: "line_11", color: "#9333ea" });
insertOrIgnoreCategory({ id: id(), name: "Cover Design", type: "expense", parentId: CONTRACT_ID, taxLine: "line_11", color: "#7c3aed" });
insertOrIgnoreCategory({ id: id(), name: "Commissioned Art", type: "expense", parentId: CONTRACT_ID, taxLine: "line_11", color: "#6d28d9" });
insertOrIgnoreCategory({ id: id(), name: "Formatting & Layout", type: "expense", parentId: CONTRACT_ID, taxLine: "line_11", color: "#5b21b6" });

// Line 13: Depreciation (assets handled separately)
insertOrIgnoreCategory({ id: id(), name: "Depreciation", type: "expense", taxLine: "line_13", color: "#6b7280" });

// Line 17: Legal & Professional Services
insertOrIgnoreCategory({ id: id(), name: "Legal & Professional", type: "expense", taxLine: "line_17", color: "#0ea5e9" });

// Line 18: Office Expense
const OFFICE_ID = id();
insertOrIgnoreCategory({ id: OFFICE_ID, name: "Office Expense", type: "expense", taxLine: "line_18", color: "#06b6d4" });
insertOrIgnoreCategory({ id: id(), name: "Office Supplies", type: "expense", parentId: OFFICE_ID, taxLine: "line_18", color: "#0891b2" });
insertOrIgnoreCategory({ id: id(), name: "Postage & Shipping Supplies", type: "expense", parentId: OFFICE_ID, taxLine: "line_18", color: "#0e7490" });

// Line 22: Supplies (cost of goods, production)
const SUPPLIES_ID = id();
insertOrIgnoreCategory({ id: SUPPLIES_ID, name: "Production & Supplies", type: "expense", taxLine: "line_22", color: "#f59e0b" });
insertOrIgnoreCategory({ id: id(), name: "Printing Costs", type: "expense", parentId: SUPPLIES_ID, taxLine: "line_22", color: "#d97706" });
insertOrIgnoreCategory({ id: id(), name: "Packaging & Mailers", type: "expense", parentId: SUPPLIES_ID, taxLine: "line_22", color: "#b45309" });
insertOrIgnoreCategory({ id: id(), name: "Merchandise & Merch Production", type: "expense", parentId: SUPPLIES_ID, taxLine: "line_22", color: "#92400e" });
insertOrIgnoreCategory({ id: id(), name: "ISBNs & Barcodes", type: "expense", parentId: SUPPLIES_ID, taxLine: "line_22", color: "#78350f" });

// Line 24a: Travel
insertOrIgnoreCategory({ id: id(), name: "Travel", type: "expense", taxLine: "line_24a", color: "#14b8a6" });

// Line 24b: Meals (50% deductible)
insertOrIgnoreCategory({ id: id(), name: "Meals (50% deductible)", type: "expense", taxLine: "line_24b", color: "#0d9488" });

// Line 27a: Other Expenses
const OTHER_ID = id();
insertOrIgnoreCategory({ id: OTHER_ID, name: "Other Business Expenses", type: "expense", taxLine: "line_27a", color: "#64748b" });
insertOrIgnoreCategory({ id: id(), name: "Event Fees & Table Costs", type: "expense", parentId: OTHER_ID, taxLine: "line_27a", color: "#475569" });
insertOrIgnoreCategory({ id: id(), name: "Shipping Costs (Outgoing)", type: "expense", parentId: OTHER_ID, taxLine: "line_27a", color: "#334155" });
insertOrIgnoreCategory({ id: id(), name: "Software Subscriptions", type: "expense", parentId: OTHER_ID, taxLine: "line_27a", color: "#1e293b" });
insertOrIgnoreCategory({ id: id(), name: "Website & Domain", type: "expense", parentId: OTHER_ID, taxLine: "line_27a", color: "#0f172a" });
insertOrIgnoreCategory({ id: id(), name: "Research & Reference Materials", type: "expense", parentId: OTHER_ID, taxLine: "line_27a", color: "#94a3b8" });

// ── Assets (not expensed directly — depreciated) ──────────────────────────────
insertOrIgnoreCategory({ id: id(), name: "Equipment Purchase", type: "asset", color: "#8b5cf6" });
insertOrIgnoreCategory({ id: id(), name: "Software (Capitalized)", type: "asset", color: "#7c3aed" });

console.log("✓ Categories seeded");

// ── Sales Channels ────────────────────────────────────────────────────────────
// Where money comes in or goes out — used to categorize transactions by source.

console.log("Seeding channels...");

insertOrIgnoreChannel({ id: id(), name: "Amazon KDP", type: "online", connector: "amazon_kdp" });
insertOrIgnoreChannel({ id: id(), name: "Ingram Spark", type: "distributor", connector: "ingram_spark" });
insertOrIgnoreChannel({ id: id(), name: "Draft to Digital", type: "online", connector: "draft_to_digital" });
insertOrIgnoreChannel({ id: id(), name: "Website (Squarespace)", type: "online", connector: "squarespace" });
insertOrIgnoreChannel({ id: id(), name: "PayPal Direct", type: "online", connector: "paypal" });
insertOrIgnoreChannel({ id: id(), name: "Convention / Event Sales", type: "in-person" });
insertOrIgnoreChannel({ id: id(), name: "Wholesale", type: "wholesale" });
insertOrIgnoreChannel({ id: id(), name: "Consignment", type: "wholesale" });
insertOrIgnoreChannel({ id: id(), name: "Pre-Sale (Beventi)", type: "online" });
insertOrIgnoreChannel({ id: id(), name: "Invoice / Direct Client", type: "online" });

console.log("✓ Channels seeded");

// ── Event Types ────────────────────────────────────────────────────────────────
// Calendar event categories — each gets a template and auto-task generation later.

console.log("Seeding event types...");

insertOrIgnoreEventType({ id: id(), name: "Book Launch", color: "#6366f1", icon: "book-open", category: "marketing", defaultDurationHours: 8 });
insertOrIgnoreEventType({ id: id(), name: "Convention / Signing", color: "#f59e0b", icon: "calendar", category: "event", defaultDurationHours: 10 });
insertOrIgnoreEventType({ id: id(), name: "Writing Sprint", color: "#22c55e", icon: "pencil", category: "writing", defaultDurationHours: 4 });
insertOrIgnoreEventType({ id: id(), name: "Editing Pass", color: "#3b82f6", icon: "edit", category: "editing", defaultDurationHours: 4 });
insertOrIgnoreEventType({ id: id(), name: "Newsletter Send", color: "#8b5cf6", icon: "mail", category: "marketing", defaultDurationHours: 1 });
insertOrIgnoreEventType({ id: id(), name: "Social Campaign", color: "#ec4899", icon: "megaphone", category: "marketing", defaultDurationHours: 2 });
insertOrIgnoreEventType({ id: id(), name: "Art Commission", color: "#f97316", icon: "palette", category: "commission", defaultDurationHours: 6 });
insertOrIgnoreEventType({ id: id(), name: "Print Run", color: "#14b8a6", icon: "printer", category: "other", defaultDurationHours: 1 });
insertOrIgnoreEventType({ id: id(), name: "Meeting", color: "#64748b", icon: "users", category: "admin", defaultDurationHours: 1 });
insertOrIgnoreEventType({ id: id(), name: "Retreat / Workshop", color: "#a855f7", icon: "mountain", category: "writing", defaultDurationHours: 24 });
insertOrIgnoreEventType({ id: id(), name: "Giveaway / Promotion", color: "#06b6d4", icon: "gift", category: "marketing", defaultDurationHours: 1 });
insertOrIgnoreEventType({ id: id(), name: "Inventory / Restock", color: "#84cc16", icon: "package", category: "other", defaultDurationHours: 2 });

console.log("✓ Event types seeded");

console.log("\n✓ Seed complete");
rawDb.close();

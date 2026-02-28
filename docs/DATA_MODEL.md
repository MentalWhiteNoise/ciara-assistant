# Ciara Assistant — Data Model

## Entity Relationship Overview

```
products ──────────────────────────────────────────────────┐
    │ (1:many)                                              │
    ├── inventory_items                                     │
    │       └── inventory_movements                        │
    │                                                      │
    └── transactions ◄──── categories                      │
            │          ◄──── channels                      │
            ├── attachments (receipts/PDFs)                │
            └── assets (long-term equipment/software)      │
                                                           │
calendar_events ◄──── event_types (templates)             │
    │   (linked to product, project, transactions)         │
    └── tasks ◄──── task_templates                        │
                                                           │
projects ────── links events, tasks, transactions ─────────┘

mileage_logs ── optionally linked to calendar_events
sync_jobs    ── tracks import history per connector
import_dedup_log ── prevents double-importing same transaction
```

---

## Tables

### `products`
Books, prints, merch, commissions — anything you make or sell.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT | ULID primary key |
| type | TEXT | `book`, `print`, `merch`, `service`, `commission` |
| title | TEXT | |
| subtitle | TEXT | |
| isbn | TEXT | |
| sku | TEXT | |
| description | TEXT | |
| cover_image | TEXT | File path |
| published_at | DATE | |
| status | TEXT | `active`, `archived`, `draft` |
| metadata | TEXT | JSON — series, edition, format, trim size, etc. |

---

### `inventory_items`
Current stock levels per product per location.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT | ULID |
| product_id | TEXT | FK → products |
| location | TEXT | `home`, `ingram`, `consignment:storename` |
| on_hand | INTEGER | Current physical count |
| reserved | INTEGER | Committed but not yet shipped |
| in_transit | INTEGER | Ordered/printing, not received yet |
| reorder_point | INTEGER | Alert threshold |
| cost_per_unit | REAL | Weighted average cost |

### `inventory_movements`
Audit log of every stock change — never delete, always append.

| Column | Type | Notes |
|--------|------|-------|
| movement_type | TEXT | `print_run`, `sale`, `return`, `damage`, `transfer`, `adjustment` |
| quantity | INTEGER | Positive = stock in, Negative = stock out |
| source_id | TEXT | FK to the transaction/event that caused this |
| source_type | TEXT | `transaction`, `event`, `manual` |

---

### `transactions`
The core financial table — every dollar in or out.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT | ULID |
| type | TEXT | `sale`, `expense`, `refund`, `transfer` |
| amount | REAL | Always positive; `type` determines direction |
| currency | TEXT | Default `USD` |
| description | TEXT | |
| category_id | TEXT | FK → categories |
| channel_id | TEXT | FK → channels (where the sale/expense happened) |
| product_id | TEXT | FK → products (optional — which book/item) |
| event_id | TEXT | FK → calendar_events (optional — which event) |
| project_id | TEXT | FK → projects (optional — which project) |
| payee | TEXT | Vendor or customer name |
| payment_method | TEXT | `paypal`, `cash`, `check`, `stripe`, etc. |
| reference_id | TEXT | External ID (PayPal txn ID, order #, etc.) |
| source | TEXT | `paypal`, `amazon_kdp`, `manual`, `squarespace`, etc. |
| tax_category | TEXT | IRS Schedule C line: `line_8`, `line_22`, etc. |
| is_tax_deductible | BOOLEAN | |
| occurred_at | DATE | When the transaction happened |
| imported_at | DATETIME | When we imported it (null if manual entry) |

---

### `categories`
Expense and income categories, aligned to IRS Schedule C.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT | ULID |
| name | TEXT | e.g., "Advertising", "Supplies", "Book Sales" |
| type | TEXT | `income`, `expense`, `asset` |
| parent_id | TEXT | Self-referential FK — for subcategories |
| tax_line | TEXT | IRS Schedule C line reference |
| color | TEXT | Hex color for UI |
| icon | TEXT | Icon name |

**Pre-seeded IRS Schedule C categories:**
- line_8: Advertising
- line_9: Car & Truck Expenses
- line_10: Commissions & Fees
- line_11: Contract Labor
- line_18: Office Expense
- line_22: Supplies
- line_24a: Travel
- line_24b: Meals (50% deductible)
- line_25: Utilities
- line_48: Other Expenses
- gross_receipts: Sales Income

---

### `channels`
Where sales happen or where expenses originate.

| Column | Type | Notes |
|--------|------|-------|
| name | TEXT | "Amazon KDP", "Ingram Spark", "Website", "Convention" |
| type | TEXT | `online`, `in-person`, `wholesale`, `distributor` |
| connector | TEXT | Which integration feeds this channel: `amazon_kdp`, `paypal`, etc. |

---

### `attachments`
Receipts, invoices, PDFs linked to transactions.

| Column | Type | Notes |
|--------|------|-------|
| transaction_id | TEXT | FK → transactions |
| file_path | TEXT | Relative path under `/data/attachments/` |
| file_type | TEXT | `receipt`, `invoice`, `contract`, `other` |
| mime_type | TEXT | |
| size_bytes | INTEGER | |

---

### `assets`
Long-term business assets (equipment, software licenses, etc.)

| Column | Type | Notes |
|--------|------|-------|
| name | TEXT | "MacBook Pro", "Epson Printer", "Adobe CC" |
| category | TEXT | `equipment`, `software`, `vehicle`, `furniture` |
| purchase_date | DATE | |
| purchase_price | REAL | |
| transaction_id | TEXT | FK → the expense transaction for the purchase |
| useful_life_years | INTEGER | For depreciation calculation |
| depreciation_method | TEXT | `straight_line` (default) |
| status | TEXT | `active`, `disposed`, `sold` |

---

### `mileage_logs`
Business mileage tracking for tax deduction.

| Column | Type | Notes |
|--------|------|-------|
| date | DATE | |
| purpose | TEXT | "Drive to signing event", "Office supply run" |
| origin | TEXT | |
| destination | TEXT | |
| miles | REAL | |
| rate | REAL | IRS standard mileage rate for the year |
| event_id | TEXT | FK → calendar_events (optional) |

---

### `event_types`
Templates for recurring event categories.

| Column | Type | Notes |
|--------|------|-------|
| name | TEXT | "Book Launch", "Convention", "Commission", "Writing Sprint" |
| color | TEXT | Calendar display color |
| metadata_schema | TEXT | JSON Schema — defines custom fields for this event type |
| default_tasks | TEXT | JSON — list of task templates to generate |
| default_duration_hours | REAL | |

---

### `calendar_events`
Scheduled events — synced with Google Calendar or entered manually.

| Column | Type | Notes |
|--------|------|-------|
| title | TEXT | |
| event_type_id | TEXT | FK → event_types |
| project_id | TEXT | FK → projects (optional) |
| product_id | TEXT | FK → products (optional) |
| start_at | DATETIME | |
| end_at | DATETIME | |
| location | TEXT | |
| metadata | TEXT | JSON — custom fields defined by event_type |
| external_id | TEXT | Google Calendar event ID |
| external_cal | TEXT | Which Google Calendar |
| status | TEXT | `scheduled`, `confirmed`, `completed`, `cancelled` |

---

### `tasks`
To-dos — standalone or linked to events/projects.

| Column | Type | Notes |
|--------|------|-------|
| title | TEXT | |
| status | TEXT | `todo`, `in_progress`, `done`, `skipped` |
| priority | TEXT | `low`, `medium`, `high`, `urgent` |
| due_date | DATE | |
| scheduled_date | DATE | Which day it appears on the daily list |
| event_id | TEXT | FK → calendar_events (if generated from event) |
| project_id | TEXT | FK → projects |
| parent_task_id | TEXT | Self-referential FK — subtasks |
| template_id | TEXT | FK → task_templates |
| recurrence | TEXT | rrule string for recurring tasks |
| tags | TEXT | JSON array |

---

### `task_templates`
Reusable task checklists attached to event types.

| Column | Type | Notes |
|--------|------|-------|
| name | TEXT | "Book Launch Checklist", "Convention Prep" |
| event_type_id | TEXT | FK → event_types |
| tasks | TEXT | JSON array: `[{title, offset_days, priority}]` |

Example `tasks` JSON:
```json
[
  { "title": "Confirm table registration", "offset_days": -30, "priority": "high" },
  { "title": "Order print run", "offset_days": -21, "priority": "high" },
  { "title": "Design banner", "offset_days": -14, "priority": "medium" },
  { "title": "Pack supplies", "offset_days": -1, "priority": "medium" },
  { "title": "Send thank-you emails", "offset_days": 1, "priority": "low" }
]
```
`offset_days` = days before (-) or after (+) the event date.

---

### `projects`
Groups related events, tasks, and transactions.

| Column | Type | Notes |
|--------|------|-------|
| name | TEXT | "Summer 2025 Book Release", "Art Commissions Q2" |
| type | TEXT | `book`, `series`, `campaign`, `commission_batch` |
| product_id | TEXT | FK → products (optional) |
| status | TEXT | `active`, `completed`, `on_hold`, `cancelled` |
| start_date | DATE | |
| target_date | DATE | |
| budget | REAL | Optional planned budget |

---

### `sync_jobs`
Audit log of every integration sync run.

| Column | Type | Notes |
|--------|------|-------|
| connector | TEXT | `amazon_kdp`, `paypal`, `google_calendar`, etc. |
| status | TEXT | `pending`, `running`, `success`, `failed` |
| records_imported | INTEGER | |
| records_skipped | INTEGER | |
| error_message | TEXT | |

### `import_dedup_log`
Prevents importing the same transaction twice.

| Column | Type | Notes |
|--------|------|-------|
| connector | TEXT | Primary key (composite) |
| external_id | TEXT | Primary key (composite) — the external transaction ID |
| imported_at | DATETIME | |
| transaction_id | TEXT | FK → the transaction we created |

---

## ID Strategy: ULIDs

All primary keys use **ULIDs** (Universally Unique Lexicographically Sortable Identifiers).
- Like UUIDs but sort chronologically
- Safe to generate on client or server without coordination
- Example: `01ARZ3NDEKTSV4RRFFQ69G5FAV`

---

## Key Query Patterns

```sql
-- Event profitability
SELECT
  e.title,
  SUM(CASE WHEN t.type = 'sale' THEN t.amount ELSE 0 END) AS revenue,
  SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END) AS expenses,
  SUM(CASE WHEN t.type = 'sale' THEN t.amount ELSE -t.amount END) AS net
FROM calendar_events e
LEFT JOIN transactions t ON t.event_id = e.id
GROUP BY e.id;

-- Book profitability
SELECT
  p.title,
  SUM(CASE WHEN t.type = 'sale' THEN t.amount ELSE 0 END) AS revenue,
  SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END) AS expenses,
  SUM(CASE WHEN t.type = 'sale' THEN t.amount ELSE -t.amount END) AS net
FROM products p
LEFT JOIN transactions t ON t.product_id = p.id
GROUP BY p.id;

-- Schedule C tax export
SELECT
  c.tax_line,
  c.name,
  SUM(t.amount) AS total
FROM transactions t
JOIN categories c ON c.id = t.category_id
WHERE t.type = 'expense'
  AND t.occurred_at BETWEEN '2025-01-01' AND '2025-12-31'
GROUP BY c.tax_line, c.name
ORDER BY c.tax_line;

-- Inventory position
SELECT
  p.title,
  ii.location,
  ii.on_hand,
  ii.reserved,
  (ii.on_hand - ii.reserved) AS available
FROM inventory_items ii
JOIN products p ON p.id = ii.product_id
ORDER BY p.title;
```

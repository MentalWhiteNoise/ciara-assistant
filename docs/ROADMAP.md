# Ciara Assistant — Development Roadmap

## Guiding Principle

Build the smallest useful thing first. Each phase should be genuinely usable
before starting the next one.

---

## Phase 1 — Foundation (MVP)
**Goal:** A working app where you can manually enter transactions, manage products,
track tasks, and view basic reports. No integrations yet.

### Infrastructure
- [x] Monorepo scaffold (Turborepo + Fastify + React + SQLite + Drizzle)
- [ ] Self-signed TLS (mkcert) for localhost + ciara.local
- [ ] PWA configuration (installable on tablet/phone)
- [ ] Authentication (master password → JWT)
- [ ] Secrets vault (AES-256-GCM encrypted credential storage)
- [ ] Database schema v1 + migrations

### Core Features
- [ ] Products/Catalog CRUD
- [ ] Transaction entry (income + expense, manual)
- [ ] Category management (pre-seeded with IRS Schedule C)
- [ ] Channel management (pre-seeded with standard channels)
- [ ] Receipt/attachment upload
- [ ] CSV import (generic — paste/upload any CSV, map columns manually)
- [ ] Basic task management (daily + weekly lists)
- [ ] Calendar view (manual events, no external sync yet)
- [ ] Dashboard (net income, recent transactions, upcoming tasks)

### Reports (Phase 1)
- [ ] Sales by channel
- [ ] Expenses by category
- [ ] Date range filtering

**Done when:** You can use this daily to track finances and tasks without it feeling like homework.

---

## Phase 2 — Integrations & Enrichment
**Goal:** Automate data ingestion from primary sources. Connect everything together.

### Integrations
- [ ] PayPal connector (OAuth2, auto-import transactions)
- [ ] Google Calendar sync (OAuth2, two-way)
- [ ] Amazon KDP CSV connector (upload report → auto-parse)
- [ ] Ingram Spark CSV connector
- [ ] Scheduled sync jobs (daily auto-import, configurable schedule)

### Feature Enrichment
- [ ] **Standalone task checklists / templates** — reusable named checklists of
  subtasks (no required dates). Open any checklist in a single full-page view
  to work through items with checkboxes. Example: "Convention Prep", "Book Launch
  Checklist", "Commission Intake". Distinct from event-driven task templates.
  DB: `task_templates` table already exists; checklist mode is a new UI surface.

- [ ] **Event type custom properties** — each event type can define its own
  metadata schema (optional + required fields). When creating an event of that
  type the form shows those fields. Example: Convention → venue, tableNumber,
  registrationCost, tableSize. Art Commission → client, medium, dimensions,
  depositPaid. DB: `event_types.metadata_schema` and `calendar_events.metadata`
  already exist; needs Settings UI to configure schemas + dynamic form rendering.

- [ ] Task templates + auto-generation from event types
- [ ] Project tracking (group events + tasks + transactions)
- [ ] Inventory management (stock levels, movements, reorder alerts)
- [ ] Mileage log
- [ ] Asset tracking + basic depreciation
- [ ] Event profitability view (event ↔ transactions ↔ inventory)
- [ ] Book/product profitability view

### Reports (Phase 2)
- [ ] Tax-ready summary (Schedule C groupings)
- [ ] Quarterly estimated tax report
- [ ] Inventory valuation report

**Done when:** You rarely need to manually enter data from PayPal or Amazon.

---

## Phase 3 — Full Automation & Advanced Features
**Goal:** Everything runs itself. Deep reporting. Mobile polish.

### Integrations
- [ ] Squarespace connector
- [ ] Pirate Ship connector (shipping costs)
- [ ] Draft to Digital connector
- [ ] Beventi / pre-sales platform

### Automation
- [ ] Workflow engine (event type → auto-generate tasks with offset dates)
- [ ] Notification system (overdue tasks, low inventory, upcoming events)
- [ ] Recurring transaction detection and auto-categorization

### Reports (Phase 3)
- [ ] Cashflow statement (monthly)
- [ ] Annual tax export (PDF-ready for accountant / TurboTax import)
- [ ] Campaign ROI (link ad spend → attributed sales)
- [ ] Marketing channel performance

### Infrastructure (Phase 3)
- [ ] Encrypted cloud backup (Litestream → Backblaze B2 or S3)
- [ ] Full offline PWA (cached pages + queued writes)
- [ ] Optional Tauri desktop wrapper

**Done when:** The app basically runs itself and tax season is not stressful.

---

## Phase 4 — Intelligence & Scale (Future)
- [ ] OCR receipt scanning (Tesseract.js, local, no cloud)
- [ ] AI-assisted categorization (Ollama local model)
- [ ] Commission management (intake form, status, invoicing)
- [ ] Wholesale order management
- [ ] Consignment tracking
- [ ] Revenue forecasting
- [ ] Multi-currency support
- [ ] True offline CRDT sync (ElectricSQL or PowerSync)

---

## Milestones

| Milestone | Description | Phase |
|-----------|-------------|-------|
| M1 | Scaffold + auth + vault working | 1 |
| M2 | Can manually enter and view transactions | 1 |
| M3 | Dashboard + basic reports working | 1 |
| M4 | Task + calendar management working | 1 |
| M5 | PWA installable on tablet/phone | 1 |
| M6 | PayPal auto-import working | 2 |
| M7 | Google Calendar sync working | 2 |
| M8 | Amazon KDP CSV import working | 2 |
| M9 | Inventory management working | 2 |
| M10 | Tax report export working | 2 |
| M11 | All major integrations connected | 3 |
| M12 | Encrypted cloud backup working | 3 |

---

## Current Status

**Phase:** 1 — Foundation
**Current task:** Monorepo scaffold

---

## Design Constraints (Don't Forget)

- Single user only — no multi-tenancy
- Local-first — no required cloud services in Phase 1 or 2
- Credentials never in frontend code or git history
- Data owned by user — always exportable as CSV/JSON
- Mobile must work on LAN — no localhost assumptions in frontend API calls

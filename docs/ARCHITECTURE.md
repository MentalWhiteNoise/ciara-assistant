# Ciara Assistant — Architecture Overview

## What This App Is

A personal business management tool for a self-published author and freelance artist.
Centralizes scheduling, task management, sales tracking, expense tracking, and tax prep.

**Design philosophy:** Local-first, privacy-first, single-user, owned data.

---

## Architecture Pattern

**Local backend + Web frontend (PWA)**

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT LAYER                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Desktop      │  │  Tablet/     │  │  Mobile          │  │
│  │  Browser      │  │  iPad PWA    │  │  Android PWA     │  │
│  │  (localhost)  │  │  (LAN/VPN)   │  │  (LAN/VPN)       │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
└─────────┼─────────────────┼───────────────────┼────────────┘
          │                 │                   │
          └─────────────────┴───────────────────┘
                            │ HTTPS (LAN / localhost)
┌─────────────────────────────────────────────────────────────┐
│                  LOCAL BACKEND (Home Machine)                │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │               API Server (Fastify / Node.js)         │   │
│  │   REST routes  │  Auth middleware  │  Sync jobs      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │               Connector Services                     │   │
│  │  PayPal │ Amazon KDP │ Ingram Spark │ Squarespace    │   │
│  │  Pirate Ship │ Google Calendar │ (future: D2D...)   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌────────────────────────┐  ┌────────────────────────┐    │
│  │  SQLite Database       │  │  Secrets Vault          │    │
│  │  (ciara.db)            │  │  (secrets.vault)        │    │
│  │  SQLCipher encrypted   │  │  AES-256-GCM encrypted  │    │
│  └────────────────────────┘  └────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  File Storage: /data/attachments/                    │   │
│  │  Receipts, PDFs, invoices, images                    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │ (optional)
┌─────────────────────────────────────────────────────────────┐
│           OPTIONAL ENCRYPTED CLOUD BACKUP                   │
│   Litestream → S3 / Backblaze B2 (encrypted replicas)       │
│   Rclone → encrypted attachment backup                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Architecture Decisions

### Why Local-First?
- Sensitive financial data never leaves your machine
- No subscription fees, no vendor lock-in
- Works offline
- You own the database file — back it up however you want

### Why SQLite?
- Single file, zero configuration, no server process to manage
- Extremely reliable (used in phones, browsers, aircraft)
- Fast enough for single-user data volumes
- Easy to inspect, copy, and back up

### Why a Local Web Backend Instead of a Desktop App?
- Works on tablet and phone over your home network
- No need to install anything on secondary devices — just open a browser
- Future-proof: can optionally expose via VPN if needed

### Why a Monorepo?
- The frontend and backend share type definitions (schemas)
- Easier to run everything together during development
- One repo, one git history, one place to look

---

## Repository Structure

```
ciara-assistant/
├── apps/
│   ├── api/                    ← Fastify backend (Node.js)
│   │   └── src/
│   │       ├── auth/           ← login, JWT, session
│   │       ├── connectors/     ← PayPal, Amazon, Google, etc.
│   │       ├── db/
│   │       │   ├── schema/     ← table definitions (Drizzle)
│   │       │   └── migrations/ ← auto-generated SQL migrations
│   │       ├── routes/         ← REST API endpoints
│   │       ├── services/       ← business logic
│   │       ├── vault/          ← secrets encryption/decryption
│   │       └── jobs/           ← scheduled sync jobs
│   └── web/                    ← React frontend
│       └── src/
│           ├── components/     ← UI components
│           ├── pages/          ← top-level route pages
│           ├── hooks/          ← custom React hooks
│           ├── stores/         ← Zustand state stores
│           └── lib/            ← utilities, API client
├── packages/
│   └── shared/                 ← shared TypeScript types and Zod schemas
│       └── src/
│           ├── schemas/        ← Zod schemas (used for validation + type generation)
│           └── types/          ← shared TypeScript types
├── data/                       ← GITIGNORED — runtime data
│   ├── ciara.db                ← SQLite database
│   ├── secrets.vault           ← encrypted credentials
│   └── attachments/            ← uploaded files
├── docs/                       ← this folder — planning documents
├── CLAUDE.md                   ← instructions for AI assistant
└── package.json                ← monorepo root
```

---

## Access Patterns

| Device | How It Connects |
|--------|----------------|
| Desktop (home machine) | `https://localhost:3001` |
| Tablet / iPad (home network) | `https://ciara.local:3001` (mDNS) |
| Phone / Android (home network) | `https://ciara.local:3001` (mDNS) |
| Remote access (travel) | Tailscale VPN → same local address |

---

## Three Core Feature Areas

```
┌──────────────────────┐
│  Scheduling & Tasks  │ ← Calendar, events, task lists, templates, workflows
└──────────┬───────────┘
           │ events link to ↓
┌──────────▼───────────┐
│  Data Collection     │ ← Sales, expenses, receipts, inventory, mileage, assets
└──────────┬───────────┘
           │ data feeds ↓
┌──────────▼───────────┐
│  Reporting & Taxes   │ ← Summaries, profitability, Schedule C, quarterly estimates
└──────────────────────┘
```

These three areas are deeply interconnected:
- A convention event links to its expenses, sales, and tasks
- A book links to its inventory, sales channel data, and marketing events
- A tax report pulls from all categorized transactions across all sources

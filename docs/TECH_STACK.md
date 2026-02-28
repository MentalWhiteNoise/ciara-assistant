# Ciara Assistant — Technology Stack

## Overview

Every technology choice here favors:
- **Stability** over novelty
- **Type safety** throughout (TypeScript end-to-end)
- **Simplicity** — nothing that requires a PhD to operate
- **Local-first** — no mandatory cloud services

---

## Backend: `apps/api/`

### Node.js 22 LTS
The runtime — executes JavaScript/TypeScript on the server.
- LTS = Long Term Support, stable and maintained
- Version 22 includes native TypeScript support improvements

### Fastify
Web framework — handles HTTP requests and routing.
Think of it like Express (if you've heard of that), but faster and built with TypeScript in mind.
- Handles: `GET /api/transactions`, `POST /api/transactions`, etc.
- Built-in schema validation, logging, plugin system
- Roughly 2-3x faster than Express under load

### Drizzle ORM
The database layer — sits between your code and SQLite.
- You write TypeScript; it generates SQL
- Unlike heavyweight ORMs (Hibernate, Sequelize), Drizzle is "SQL-first":
  you still think in SQL tables and queries, but you get TypeScript types for free
- Your schema is defined in TypeScript files → Drizzle generates migration SQL
- If you know SQL well, you'll feel at home — Drizzle doesn't hide SQL from you

### better-sqlite3
The SQLite driver — the actual library that talks to the `.db` file.
- Synchronous (not async) — SQLite is fast enough that async overhead isn't worth it
- Battle-tested, widely used

### Zod
Schema validation library.
- You define the shape of data once (e.g., "a transaction has an amount, a date, a category")
- Zod gives you: runtime validation + TypeScript types automatically
- Used on both frontend and backend (via `packages/shared`) so both sides agree on data shapes

### node-cron
Scheduled job runner — like a cron job but in Node.
- Runs tasks on a schedule: "every day at 2am, sync PayPal transactions"

### JWT (jsonwebtoken)
Authentication tokens.
- After you log in with your master password, the server issues a JWT (JSON Web Token)
- Your browser sends this token with every request to prove you're authenticated
- Tokens expire (configurable), then you log in again

---

## Frontend: `apps/web/`

### React 19 + TypeScript
UI framework — builds the web interface.
- React = component-based UI (break the UI into reusable pieces)
- TypeScript = JavaScript with types (catches mistakes before runtime)

### Vite
Build tool and dev server.
- Replaces older tools like webpack/Create React App
- Starts the dev server in milliseconds, not seconds
- Handles bundling for production

### shadcn/ui + Tailwind CSS
UI component library + styling.
- shadcn/ui: a collection of pre-built components (buttons, dialogs, tables, forms)
  Unlike most component libraries, shadcn copies the component code into your project
  — you own it and can customize it completely
- Tailwind CSS: utility-first CSS framework
  Instead of writing `.button { color: red }`, you write `className="text-red-500"`
  Sounds odd at first, works extremely well in practice

### Zustand
Client-side state management.
- Stores global UI state (current user, sidebar open/closed, etc.)
- Much simpler than Redux — a store is just a JavaScript object with update functions

### TanStack Query v5 (formerly React Query)
Server state management — handles fetching data from the API.
- Handles loading/error states automatically
- Caches responses so you don't re-fetch unnecessarily
- Background refetch keeps data fresh
- Replaces a lot of manual `useEffect` + `useState` fetch logic

### TanStack Table v8
Headless table library.
- Powers the transaction list, reports, inventory tables
- "Headless" means it handles logic (sorting, filtering, pagination) but you control the HTML/CSS
- Extremely flexible

### FullCalendar
Calendar component.
- Powers the scheduling/calendar view
- Supports month, week, day, and list views
- Can sync with Google Calendar events

### Recharts
Charting library.
- Powers income/expense charts, trend graphs on the dashboard
- Built on D3 but much simpler to use

### React Hook Form + Zod
Form handling.
- React Hook Form: manages form state, validation, submission
- Paired with Zod: the same schemas used on the backend validate forms on the frontend
- Means you can't submit a transaction with an invalid date format — caught on both ends

### Vite PWA Plugin
Makes the app installable as a Progressive Web App.
- Generates a Service Worker (background script that caches assets)
- Lets you "Add to Home Screen" on iPad/Android
- Enables offline access to previously loaded pages

---

## Shared: `packages/shared/`

### Zod schemas + TypeScript types
- Both `apps/api` and `apps/web` import from here
- If a Transaction has 15 fields, that definition lives in ONE place
- Change it once, TypeScript errors surface everywhere that needs updating

---

## Tooling

### Turborepo
Monorepo build system.
- Manages the fact that we have three packages (`api`, `web`, `shared`) in one repo
- Smart caching: if `shared` hasn't changed, it doesn't rebuild it
- `turbo dev` starts both `api` and `web` simultaneously
- Think of it as the orchestrator — it knows the dependency graph

### pnpm
Package manager (like npm or yarn, but faster and more disk-efficient).
- Uses symlinks so packages are only downloaded once even if used in multiple workspaces
- Required for Turborepo workspace support

### mkcert
Local TLS certificate generator.
- Creates a real SSL certificate for `localhost` and `ciara.local`
- Required for PWA features (service workers require HTTPS)
- One-time setup

---

## Optional / Phase 3

| Tool | Purpose |
|------|---------|
| Litestream | Continuous SQLite replication to cloud storage |
| age | File encryption for backups |
| Tauri | Desktop app wrapper (smaller than Electron) |
| Playwright | Browser automation for sites without APIs (e.g., KDP report download) |
| Ollama | Local AI for receipt categorization (no cloud required) |

---

## What We Are NOT Using (and Why)

| Skipped | Why |
|---------|-----|
| PostgreSQL / MySQL | Overkill for single-user local app; SQLite is the right tool here |
| Docker | Adds complexity; Node + SQLite runs fine without containers |
| Redux | Zustand is simpler and sufficient |
| Next.js | Server-side rendering not needed; Vite SPA is simpler for local app |
| Prisma | Good ORM, but heavier than Drizzle; Drizzle's SQL-first approach fits better |
| GraphQL | REST is simpler and sufficient for this use case |
| Electron | Tauri is smaller if we ever need a desktop wrapper; not needed for MVP |

// This script runs all pending database migrations.
// Run it with: pnpm db:migrate
//
// How Drizzle migrations work:
//   1. You define tables in TypeScript schema files (src/db/schema/)
//   2. `pnpm db:generate` diffs your schema against what's already in the DB
//      and writes a .sql migration file into src/db/migrations/
//   3. This script reads those .sql files and executes them on the database
//   4. Drizzle tracks which migrations have already run in a __drizzle_migrations table
//      so re-running this script is always safe

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import { db, rawDb } from "./client.js";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "migrations");

console.log("Running migrations from:", MIGRATIONS_DIR);

migrate(db, { migrationsFolder: MIGRATIONS_DIR });

console.log("✓ Migrations complete");

// Close the database cleanly after migration
rawDb.close();

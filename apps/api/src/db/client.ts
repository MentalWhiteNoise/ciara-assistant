import Database, { type Database as BetterSqlite3Database } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import fs from "fs";
import * as schema from "./schema/index.js";

// Resolve the data directory — sits at repo root, outside of src/
// In dev: ../../data relative to apps/api/src/db/
// We use an env var so it can be overridden in production
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "../../data");

// Ensure the data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "ciara.db");

// Open (or create) the SQLite database file
const sqlite = new Database(DB_PATH);

// Performance settings for SQLite
// WAL mode = Write-Ahead Logging: much better performance for concurrent reads
sqlite.pragma("journal_mode = WAL");
// foreign_keys = enforce foreign key constraints (SQLite has these off by default)
sqlite.pragma("foreign_keys = ON");

// drizzle() wraps the raw SQLite connection with Drizzle's query builder
// The schema argument lets Drizzle know about all our tables for type inference
export const db = drizzle(sqlite, { schema });

// Export the raw connection too — useful for migrations and transactions
export const rawDb: BetterSqlite3Database = sqlite;

console.log(`Database opened: ${DB_PATH}`);

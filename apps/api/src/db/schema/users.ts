import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Single-user app — but we still need to store the hashed master password
// and session refresh tokens somewhere.
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  passwordHash: text("password_hash").notNull(), // Argon2id hash
  displayName: text("display_name").notNull().default("Owner"),
  // App-level settings stored as JSON
  settings: text("settings"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Refresh tokens — stored server-side so we can invalidate them on logout
export const refreshTokens = sqliteTable("refresh_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(), // we store the hash, not the raw token
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

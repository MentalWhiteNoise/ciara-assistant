// Token generation helpers for refresh tokens.
// Access tokens (JWTs) are handled by @fastify/jwt.
// Refresh tokens are opaque random strings stored as hashes in the DB.

import { randomBytes, createHash } from "crypto";
import { db } from "../db/client.js";
import { refreshTokens } from "../db/schema/index.js";
import { eq, lt } from "drizzle-orm";
import { ulid } from "ulid";

const REFRESH_TOKEN_EXPIRY_DAYS = 7;

// Generate a cryptographically random refresh token.
// We store only the SHA-256 hash in the DB — the raw token is never persisted.
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(48).toString("base64url"); // 48 bytes → 64 base64url chars
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// Persist a new refresh token for a user
export function saveRefreshToken(userId: string, tokenHash: string): void {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  db.insert(refreshTokens).values({
    id: ulid(),
    userId,
    tokenHash,
    expiresAt: expiresAt.toISOString(),
  }).run();
}

// Look up and validate a refresh token. Returns userId if valid, null otherwise.
export function consumeRefreshToken(rawToken: string): string | null {
  const hash = hashToken(rawToken);
  const now = new Date().toISOString();

  const row = db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hash))
    .get();

  if (!row) return null;
  if (row.expiresAt < now) {
    // Expired — clean it up
    db.delete(refreshTokens).where(eq(refreshTokens.id, row.id)).run();
    return null;
  }

  // Rotate: delete the used token (one-time use)
  db.delete(refreshTokens).where(eq(refreshTokens.id, row.id)).run();
  return row.userId;
}

// Delete all refresh tokens for a user (logout all devices)
export function revokeAllTokens(userId: string): void {
  db.delete(refreshTokens).where(eq(refreshTokens.userId, userId)).run();
}

// Housekeeping — prune expired tokens. Called on server start.
export function pruneExpiredTokens(): void {
  const now = new Date().toISOString();
  db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, now)).run();
}

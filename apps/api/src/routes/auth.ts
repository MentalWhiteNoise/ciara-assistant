// Auth routes:
//   POST /auth/setup    — first-run only: set the master password
//   POST /auth/login    — verify password, issue tokens
//   POST /auth/refresh  — exchange refresh token for new access token
//   POST /auth/logout   — invalidate refresh token
//   GET  /auth/status   — is the app set up? is this request authenticated?

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ulid } from "ulid";
import { db } from "../db/client.js";
import { users } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  generateRefreshToken,
  saveRefreshToken,
  consumeRefreshToken,
  revokeAllTokens,
} from "../auth/tokens.js";

// How long access tokens live (15 minutes in seconds)
const ACCESS_TOKEN_TTL = 15 * 60;
// Cookie name for the refresh token
const REFRESH_COOKIE = "ciara_refresh";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getUser() {
  return db.select().from(users).get(); // single-user app
}

function isSetupComplete(): boolean {
  return !!getUser();
}

function setRefreshCookie(reply: any, token: string) {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,   // JS cannot read this cookie — XSS protection
    secure: true,     // HTTPS only
    sameSite: "Strict",
    path: "/auth",    // cookie only sent to /auth/* routes
    maxAge: 60 * 60 * 24 * 7, // 7 days in seconds
  });
}

function clearRefreshCookie(reply: any) {
  reply.clearCookie(REFRESH_COOKIE, { path: "/auth" });
}

// ── Route registration ─────────────────────────────────────────────────────────

export async function authRoutes(app: FastifyInstance) {
  // ── GET /auth/status ────────────────────────────────────────────────────────
  // Returns whether the app has been set up (password configured).
  // The frontend uses this on first load to decide whether to show setup vs login.
  app.get("/status", async () => {
    return { configured: isSetupComplete() };
  });

  // ── POST /auth/setup ────────────────────────────────────────────────────────
  // One-time setup: creates the master password.
  // Returns 409 if already set up.
  app.post("/setup", async (request, reply) => {
    if (isSetupComplete()) {
      return reply.code(409).send({ error: "Already configured" });
    }

    const body = z
      .object({
        password: z.string().min(8, "Password must be at least 8 characters"),
        displayName: z.string().min(1).optional(),
      })
      .safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    const passwordHash = await hashPassword(body.data.password);

    db.insert(users)
      .values({
        id: ulid(),
        passwordHash,
        displayName: body.data.displayName ?? "Owner",
      })
      .run();

    return reply.code(201).send({ ok: true });
  });

  // ── POST /auth/login ────────────────────────────────────────────────────────
  // Verify master password → issue access token (JWT) + refresh token (cookie).
  app.post("/login", async (request, reply) => {
    if (!isSetupComplete()) {
      return reply.code(403).send({ error: "App not configured yet" });
    }

    const body = z
      .object({ password: z.string() })
      .safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({ error: "Password required" });
    }

    const user = getUser()!;
    const valid = await verifyPassword(user.passwordHash, body.data.password);

    if (!valid) {
      // Deliberate vague error — don't confirm whether user exists
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    // Issue access token (JWT) — expires in 15 minutes
    // app.jwt is registered by @fastify/jwt in the server setup
    const accessToken = (app as any).jwt.sign(
      { sub: user.id, name: user.displayName },
      { expiresIn: ACCESS_TOKEN_TTL }
    );

    // Issue refresh token — stored as hash in DB, raw value in httpOnly cookie
    const { raw, hash } = generateRefreshToken();
    saveRefreshToken(user.id, hash);
    setRefreshCookie(reply, raw);

    return {
      accessToken,
      user: { id: user.id, displayName: user.displayName },
    };
  });

  // ── POST /auth/refresh ──────────────────────────────────────────────────────
  // Exchange a valid refresh token cookie for a new access token.
  // The old refresh token is consumed (rotated) and a new one is issued.
  app.post("/refresh", async (request, reply) => {
    const rawToken = (request.cookies as any)[REFRESH_COOKIE];

    if (!rawToken) {
      return reply.code(401).send({ error: "No refresh token" });
    }

    const userId = consumeRefreshToken(rawToken);

    if (!userId) {
      clearRefreshCookie(reply);
      return reply.code(401).send({ error: "Invalid or expired refresh token" });
    }

    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      clearRefreshCookie(reply);
      return reply.code(401).send({ error: "User not found" });
    }

    // Issue new access token
    const accessToken = (app as any).jwt.sign(
      { sub: user.id, name: user.displayName },
      { expiresIn: ACCESS_TOKEN_TTL }
    );

    // Rotate refresh token
    const { raw, hash } = generateRefreshToken();
    saveRefreshToken(user.id, hash);
    setRefreshCookie(reply, raw);

    return {
      accessToken,
      user: { id: user.id, displayName: user.displayName },
    };
  });

  // ── POST /auth/logout ───────────────────────────────────────────────────────
  // Invalidate the refresh token. Access token will expire on its own (15 min).
  app.post("/logout", async (request, reply) => {
    // Best-effort: try to revoke via refresh cookie
    const rawToken = (request.cookies as any)[REFRESH_COOKIE];
    if (rawToken) {
      consumeRefreshToken(rawToken); // this deletes it from DB
    }
    clearRefreshCookie(reply);
    return { ok: true };
  });
}

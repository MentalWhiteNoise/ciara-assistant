import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { getJwtSecret } from "./auth/jwt-secret.js";
import { registerAuthMiddleware } from "./auth/middleware.js";
import { authRoutes } from "./routes/auth.js";
import { productRoutes } from "./routes/products.js";
import { transactionRoutes } from "./routes/transactions.js";
import { referenceRoutes } from "./routes/reference.js";
import { taskRoutes } from "./routes/tasks.js";
import { calendarRoutes } from "./routes/calendar.js";
import { orderRoutes } from "./routes/orders.js";
import { checklistRoutes } from "./routes/checklists.js";
import { checklistTemplateRoutes } from "./routes/checklist-templates.js";
import { settingsRoutes } from "./routes/settings.js";
import { pruneExpiredTokens } from "./auth/tokens.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      transport:
        process.env.NODE_ENV !== "production"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
  });

  // ── Plugins ──────────────────────────────────────────────────────────────

  await app.register(cors, {
    origin: [
      "http://localhost:5173",       // Vite dev server
      "https://localhost:5173",
      "https://localhost:3001",
      /^https:\/\/ciara\.local/,     // tablet / phone on LAN (mkcert)
      // RFC 1918 private IP ranges — covers 192.168.x.x, 10.x.x.x, 172.16-31.x.x
      /^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/,
    ],
    credentials: true,
  });

  // Cookie plugin — needed for the httpOnly refresh token cookie
  await app.register(cookie, {
    secret: getJwtSecret(), // signs cookies to detect tampering
  });

  // JWT plugin — handles signing and verification of access tokens
  // getJwtSecret() loads our persisted random secret from data/jwt.secret
  await app.register(jwt, {
    secret: getJwtSecret(),
  });

  // Register app.authenticate — the preHandler we attach to protected routes
  registerAuthMiddleware(app);

  // ── Startup tasks ─────────────────────────────────────────────────────────

  // Prune stale refresh tokens from the DB each time the server starts
  pruneExpiredTokens();

  // ── Routes ───────────────────────────────────────────────────────────────

  // Health check — no auth required
  app.get("/health", async () => ({
    status: "ok",
    ts: new Date().toISOString(),
  }));

  // Auth routes — no JWT required (they ARE the auth)
  await app.register(authRoutes, { prefix: "/auth" });

  // ── Protected API routes (require JWT) ───────────────────────────────────
  await app.register(productRoutes, { prefix: "/api/products" });
  await app.register(transactionRoutes, { prefix: "/api/transactions" });
  await app.register(taskRoutes, { prefix: "/api/tasks" });
  await app.register(calendarRoutes, { prefix: "/api" });
  await app.register(orderRoutes, { prefix: "/api/orders" });
  await app.register(checklistRoutes, { prefix: "/api/checklists" });
  await app.register(checklistTemplateRoutes, { prefix: "/api/checklist-templates" });
  await app.register(referenceRoutes, { prefix: "/api" });
  await app.register(settingsRoutes, { prefix: "/api" });

  return app;
}

async function start() {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? "0.0.0.0";

  try {
    await app.listen({ port, host });
    console.log(`\n  Ciara API running at http://localhost:${port}`);
    console.log(`  Health:  http://localhost:${port}/health`);
    console.log(`  Auth:    http://localhost:${port}/auth/status\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();

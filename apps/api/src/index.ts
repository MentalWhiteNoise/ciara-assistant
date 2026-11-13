import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import pretty from "pino-pretty";
import { readFileSync } from "fs";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
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
import { attachmentRoutes } from "./routes/attachments.js";
import { settingsRoutes } from "./routes/settings.js";
import { vaultRoutes } from "./routes/vault.js";
import { syncRoutes } from "./routes/sync.js";
import { kdpRoutes } from "./routes/kdp.js";
import { refreshKdpReminders } from "./connectors/kdp/schedule.js";
import { pruneExpiredTokens } from "./auth/tokens.js";

// ── TLS ──────────────────────────────────────────────────────────────────────
// Load mkcert certs from data/ if present. Falls back to HTTP if not found.
// data/ is three levels above apps/api/src/ (or apps/api/dist/ in production).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../../../data");

function loadTls() {
  const certFile = path.join(dataDir, "ciara.pem");
  const keyFile  = path.join(dataDir, "ciara-key.pem");
  if (!existsSync(certFile) || !existsSync(keyFile)) return null;
  return { cert: readFileSync(certFile), key: readFileSync(keyFile) };
}

const tls = loadTls();

export async function buildApp() {
  // In dev, pretty-print logs in the main thread. (Pino's "transport" option
  // runs pino-pretty in a worker thread, which crashes under Node 24 + tsx.)
  const logger =
    process.env.NODE_ENV !== "production"
      ? { stream: pretty({ colorize: true }) }
      : true;

  // Fastify's TypeScript types are generic over the server kind (http vs https),
  // and our route plugins are typed against the default http server. The
  // request/reply API is identical either way, so we present both variants
  // under the default type rather than threading the generic through every file.
  const app = (
    tls ? Fastify({ https: tls, logger }) : Fastify({ logger })
  ) as unknown as FastifyInstance;

  // ── Plugins ──────────────────────────────────────────────────────────────

  // Multipart file upload support — used by the attachment upload route.
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10 MB max, one file at a time
  });

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

  // Report-download reminders (KDP monthly checklist etc.). Creates any reminder
  // that has come due and ticks off ones already satisfied. Runs now and every
  // 6 hours, so a server left running across the 10th still creates it.
  const runReminders = () => {
    try {
      refreshKdpReminders();
    } catch (err) {
      app.log.error(err, "Reminder refresh failed");
    }
  };
  runReminders();
  setInterval(runReminders, 6 * 60 * 60 * 1000).unref();

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
  await app.register(attachmentRoutes, { prefix: "/api" });
  await app.register(referenceRoutes, { prefix: "/api" });
  await app.register(settingsRoutes, { prefix: "/api" });
  await app.register(vaultRoutes, { prefix: "/api" });
  await app.register(syncRoutes, { prefix: "/api" });
  await app.register(kdpRoutes, { prefix: "/api" });

  return app;
}

async function start() {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? "0.0.0.0";

  try {
    await app.listen({ port, host });
    const proto = tls ? "https" : "http";
    console.log(`\n  Ciara API running at ${proto}://localhost:${port}`);
    console.log(`  Health:  ${proto}://localhost:${port}/health`);
    console.log(`  Auth:    ${proto}://localhost:${port}/auth/status\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();

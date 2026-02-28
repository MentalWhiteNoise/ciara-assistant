import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";

// Build the Fastify app — exported so tests can import it too
export async function buildApp() {
  const app = Fastify({
    logger: {
      // Pretty-print logs in development, JSON in production
      transport:
        process.env.NODE_ENV !== "production"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
  });

  // ── Plugins ──────────────────────────────────────────────────────────────

  // CORS: allow requests from the frontend dev server and local network
  await app.register(cors, {
    origin: [
      "http://localhost:5173",       // Vite dev server
      "https://localhost:5173",
      "https://localhost:3001",
      /^https:\/\/ciara\.local/,     // tablet / phone on LAN
    ],
    credentials: true,
  });

  // Cookie support — needed for httpOnly refresh token
  await app.register(cookie, {
    secret: process.env.COOKIE_SECRET ?? "change-me-in-production",
  });

  // ── Routes ───────────────────────────────────────────────────────────────

  // Health check — useful to verify server is up
  app.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

  // TODO (Phase 1): register route modules here
  // await app.register(authRoutes, { prefix: "/auth" });
  // await app.register(transactionRoutes, { prefix: "/api/transactions" });
  // await app.register(productRoutes, { prefix: "/api/products" });

  return app;
}

// Start the server
async function start() {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? "0.0.0.0"; // 0.0.0.0 = listen on all interfaces (needed for LAN)

  try {
    await app.listen({ port, host });
    console.log(`\n  Ciara API running at http://localhost:${port}`);
    console.log(`  Health check: http://localhost:${port}/health\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();

// Reference data routes — read-only lookups used to populate dropdowns.
//   GET /api/categories  — all categories, grouped by type
//   GET /api/channels    — all active channels

import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { categories, channels } from "../db/schema/index.js";
import { asc, eq } from "drizzle-orm";

export async function referenceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // ── GET /api/categories ──────────────────────────────────────────────────────
  app.get("/categories", async () => {
    return db.select().from(categories).orderBy(asc(categories.name)).all();
  });

  // ── GET /api/channels ────────────────────────────────────────────────────────
  app.get("/channels", async () => {
    return db
      .select()
      .from(channels)
      .where(eq(channels.isActive, true))
      .orderBy(asc(channels.name))
      .all();
  });
}

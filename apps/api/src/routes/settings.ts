// Settings routes — read and update the single user's account preferences.
//   GET /api/settings   — return displayName
//   PUT /api/settings   — update displayName

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { users } from "../db/schema/index.js";

const UpdateSettingsSchema = z.object({
  displayName: z.string().min(1).optional(),
});

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // ── GET /api/settings ────────────────────────────────────────────────────────
  app.get("/settings", async (_req, reply) => {
    // Single-user app — just grab the first (only) user row
    const user = db.select().from(users).get();
    if (!user) return reply.code(404).send({ error: "User not found" });
    return { displayName: user.displayName };
  });

  // ── PUT /api/settings ────────────────────────────────────────────────────────
  app.put("/settings", async (req, reply) => {
    const body = UpdateSettingsSchema.parse(req.body);
    const user = db.select().from(users).get();
    if (!user) return reply.code(404).send({ error: "User not found" });

    db.update(users)
      .set({
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        updatedAt: new Date().toISOString(),
      })
      .run();

    const updated = db.select().from(users).get()!;
    return { displayName: updated.displayName };
  });
}

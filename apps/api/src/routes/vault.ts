// Vault + integration credential routes. All require JWT auth.
//
//   GET    /api/vault/status          — { exists, unlocked }
//   POST   /api/vault/unlock          — { password } → unlocks (e.g. after a server restart)
//   POST   /api/vault/lock            — forget the key until next unlock
//   GET    /api/integrations          — definitions + connected status (never secret values)
//   PUT    /api/integrations/:id      — { credentials: { field: value } } → store in vault
//   DELETE /api/integrations/:id      — remove stored credentials
//   POST   /api/integrations/:id/test — try the saved credentials against the service
//
// Credentials go IN through these routes but never come back OUT.
// Connectors read them server-side via getSecret().

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { users } from "../db/schema/index.js";
import { verifyPassword } from "../auth/password.js";
import {
  vaultExists,
  isUnlocked,
  unlock,
  lock,
  getSecret,
  setSecret,
  deleteSecret,
  listStored,
} from "../vault/vault.js";
import { INTEGRATIONS, getIntegration } from "../connectors/definitions.js";
import { CONNECTION_TESTERS } from "../connectors/testers.js";
import { clearPayPalToken } from "../connectors/paypal/client.js";

const UnlockSchema = z.object({ password: z.string().min(1) });
const CredentialsSchema = z.object({
  credentials: z.record(z.string(), z.string()),
});

export async function vaultRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // ── Vault ───────────────────────────────────────────────────────────────────

  app.get("/vault/status", async () => ({
    exists: vaultExists(),
    unlocked: isUnlocked(),
  }));

  app.post("/vault/unlock", async (req, reply) => {
    const body = UnlockSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Password required" });

    // Check against the login hash first. This guarantees the vault is only
    // ever created/unlocked with the real master password.
    const user = db.select().from(users).get();
    if (!user || !(await verifyPassword(user.passwordHash, body.data.password))) {
      return reply.code(401).send({ error: "Incorrect password" });
    }

    const ok = await unlock(body.data.password);
    if (!ok) {
      // Login password is right but doesn't open the vault — it was created
      // with an older password. Don't overwrite it; surface the problem.
      return reply.code(409).send({
        error: "The vault was encrypted with a different password and can't be opened.",
      });
    }
    return { exists: true, unlocked: true };
  });

  app.post("/vault/lock", async () => {
    lock();
    clearPayPalToken(); // in-memory API tokens go away with the vault key
    return { exists: vaultExists(), unlocked: false };
  });

  // ── Integrations ────────────────────────────────────────────────────────────

  app.get("/integrations", async () => {
    const unlocked = isUnlocked();
    const stored = unlocked ? listStored() : {};
    return {
      vaultUnlocked: unlocked,
      integrations: INTEGRATIONS.map((def) => ({
        ...def,
        // null = unknown (vault locked); otherwise whether credentials are saved
        connected: unlocked ? def.id in stored : null,
        connectedAt: stored[def.id]?.updatedAt ?? null,
        // Saved values of dropdown fields only (e.g. sandbox/live). Never
        // free-text fields — those may be secrets or identifiers.
        settings: unlocked ? dropdownValues(def.id) : {},
      })),
    };
  });

  app.put<{ Params: { id: string } }>("/integrations/:id", async (req, reply) => {
    const def = getIntegration(req.params.id);
    if (!def) return reply.code(404).send({ error: "Unknown integration" });
    if (def.authType !== "api_key") {
      return reply.code(400).send({ error: `${def.displayName} doesn't take credentials` });
    }
    if (!isUnlocked()) return reply.code(423).send({ error: "Vault is locked" });

    const body = CredentialsSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid credentials payload" });

    // Keep only known fields, trimmed; require the non-optional ones.
    const credentials: Record<string, string> = {};
    for (const field of def.fields) {
      const value = body.data.credentials[field.key]?.trim() || field.default || "";
      if (!value && !field.optional) {
        return reply.code(400).send({ error: `${field.label} is required` });
      }
      if (value && field.options && !field.options.some((o) => o.value === value)) {
        return reply.code(400).send({ error: `${field.label} has an invalid value` });
      }
      if (value) credentials[field.key] = value;
    }

    setSecret(def.id, credentials);
    return { id: def.id, connected: true };
  });

  app.post<{ Params: { id: string } }>("/integrations/:id/test", async (req, reply) => {
    const def = getIntegration(req.params.id);
    if (!def) return reply.code(404).send({ error: "Unknown integration" });
    const tester = CONNECTION_TESTERS[def.id];
    if (!tester) return reply.code(400).send({ error: `Testing ${def.displayName} isn't supported yet` });
    if (!isUnlocked()) return reply.code(423).send({ error: "Vault is locked" });
    if (!getSecret(def.id)) return reply.code(400).send({ error: "No credentials saved" });

    // Testers return { ok, message, details } and never throw for expected
    // failures (bad credentials, missing permission) — those are ok:false.
    return tester();
  });

  app.delete<{ Params: { id: string } }>("/integrations/:id", async (req, reply) => {
    const def = getIntegration(req.params.id);
    if (!def) return reply.code(404).send({ error: "Unknown integration" });
    if (!isUnlocked()) return reply.code(423).send({ error: "Vault is locked" });

    deleteSecret(def.id);
    return { id: def.id, connected: false };
  });
}

/** Saved values for an integration's dropdown fields (non-sensitive by definition). */
function dropdownValues(id: string): Record<string, string> {
  const def = getIntegration(id);
  const creds = getSecret(id)?.credentials ?? {};
  const out: Record<string, string> = {};
  for (const f of def?.fields ?? []) {
    if (f.options && typeof creds[f.key] === "string") out[f.key] = creds[f.key] as string;
  }
  return out;
}

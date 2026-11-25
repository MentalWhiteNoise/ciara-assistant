// Review queue for imported transactions that might be personal.
//
//   GET  /api/review/groups  — "needs review" transactions grouped by payee
//   POST /api/review/decide  — mark transactions business/personal, optionally
//                              remembering the decision as a payee rule
//
// Grouping by payee is what makes the backlog manageable: a monthly
// subscription paid 30 times is one decision, not 30.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ulid } from "ulid";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { payeeRules, transactions } from "../db/schema/index.js";

const DecideSchema = z.object({
  transactionIds: z.array(z.string()).min(1),
  action: z.enum(["business", "personal", "needs_review"]),
  categoryId: z.string().nullable().optional(),
  channelId: z.string().nullable().optional(),
  /** Save as a rule and apply to every other unreviewed payment with this payee. */
  remember: z.boolean().default(false),
});

type Tx = typeof transactions.$inferSelect;

// Rows whose business/personal status is decided by the transaction they're
// linked to: Chase foreign transaction fees (see connectors/chase/import.ts).
// Their category stays their own (a fee), only the decision is shared.
const FOLLOWING_SOURCES = ["chase"];
const followsParent = (t: Pick<Tx, "source" | "relatedTransactionId">) =>
  FOLLOWING_SOURCES.includes(t.source) && !!t.relatedTransactionId;

export async function reviewRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/review/groups", async () => {
    const rows = db
      .select()
      .from(transactions)
      .where(eq(transactions.reviewStatus, "needs_review"))
      .orderBy(asc(transactions.occurredAt))
      .all()
      // Card fees that follow their charge aren't decided on their own.
      .filter((t) => !followsParent(t));

    const groups = new Map<string, { key: string; payee: string | null; counterpartyId: string | null; source: string; transactions: Tx[] }>();
    for (const t of rows) {
      const key = `${t.source}|${t.counterpartyId ?? `payee:${t.payee ?? ""}`}`;
      let g = groups.get(key);
      if (!g) {
        g = { key, payee: t.payee, counterpartyId: t.counterpartyId, source: t.source, transactions: [] };
        groups.set(key, g);
      }
      g.transactions.push(t);
    }

    return [...groups.values()]
      .map((g) => ({
        ...g,
        count: g.transactions.length,
        total: Math.round(g.transactions.reduce((s, t) => s + t.amount, 0) * 100) / 100,
        firstDate: g.transactions[0].occurredAt,
        lastDate: g.transactions[g.transactions.length - 1].occurredAt,
      }))
      .sort((a, b) => b.count - a.count || b.total - a.total);
  });

  app.post("/review/decide", async (req, reply) => {
    const body = DecideSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    const { transactionIds, action, categoryId, channelId, remember } = body.data;

    const status = action === "business" ? "confirmed" : action;
    const now = new Date().toISOString();
    let updated = 0;
    let rulesSaved = 0;

    db.transaction((tx) => {
      const targets = tx.select().from(transactions).where(inArray(transactions.id, transactionIds)).all();

      const apply = (ids: string[]) => {
        if (!ids.length) return;
        tx.update(transactions)
          .set({
            reviewStatus: status,
            // Only set category/channel when deciding "business" and one was chosen.
            ...(action === "business" && categoryId !== undefined ? { categoryId } : {}),
            ...(action === "business" && channelId !== undefined ? { channelId } : {}),
            // Business purchases are deductible; personal ones aren't.
            ...(action !== "needs_review" ? { isTaxDeductible: action === "business" } : {}),
            updatedAt: now,
          })
          .where(inArray(transactions.id, ids))
          .run();
        updated += ids.length;

        // Linked fees follow: same decision, their own category.
        tx.update(transactions)
          .set({
            reviewStatus: status,
            ...(action !== "needs_review" ? { isTaxDeductible: action === "business" } : {}),
            updatedAt: now,
          })
          .where(and(inArray(transactions.relatedTransactionId, ids), inArray(transactions.source, FOLLOWING_SOURCES)))
          .run();
      };
      apply(targets.map((t) => t.id));

      if (remember && action !== "needs_review") {
        const parties = new Map<string, Tx>();
        for (const t of targets) if (t.counterpartyId) parties.set(`${t.source}|${t.counterpartyId}`, t);

        for (const t of parties.values()) {
          const values = {
            connector: t.source,
            counterpartyId: t.counterpartyId!,
            counterpartyName: t.payee,
            action: action as "business" | "personal",
            categoryId: action === "business" ? categoryId ?? null : null,
            channelId: action === "business" ? channelId ?? null : null,
          };
          tx.insert(payeeRules)
            .values({ id: ulid(), ...values, createdAt: now })
            .onConflictDoUpdate({ target: [payeeRules.connector, payeeRules.counterpartyId], set: values })
            .run();
          rulesSaved++;

          // Apply to the rest of this payee's unreviewed transactions.
          const others = tx
            .select({ id: transactions.id })
            .from(transactions)
            .where(and(
              eq(transactions.source, t.source),
              eq(transactions.counterpartyId, t.counterpartyId!),
              eq(transactions.reviewStatus, "needs_review"),
            ))
            .all()
            .map((o) => o.id);
          apply(others);
        }
      }
    });

    return { updated, rulesSaved };
  });
}

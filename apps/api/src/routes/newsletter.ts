// Newsletter (MailerLite) routes — everything comes from records the MailerLite
// download already stored; nothing here calls MailerLite.
//
//   GET /api/newsletter       — plan, latest subscriber counts, monthly signups,
//                               sent campaigns, emails sent this month
//   PUT /api/newsletter/plan  — save the plan details (shown on the page; used
//                               for the limit warnings)

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, like } from "drizzle-orm";
import { db } from "../db/client.js";
import { importRawRecords, syncJobs, users } from "../db/schema/index.js";
import { MAILERLITE_CONNECTOR } from "../connectors/mailerlite/sync.js";

const PlanSchema = z.object({
  name: z.string().min(1).max(100),
  subscriberLimit: z.number().int().positive(),
  emailLimit: z.number().int().positive(),
  annualCost: z.number().nonnegative(),
  /** YYYY-MM-DD */
  nextPaymentDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
type Plan = z.infer<typeof PlanSchema>;

// Used until a plan is saved. Values from the MailerLite billing page, 2026-11-14.
const DEFAULT_PLAN: Plan = {
  name: "Comfort",
  subscriberLimit: 1000,
  emailLimit: 10000,
  annualCost: 205.2,
  nextPaymentDue: "2027-09-04",
};

function readSettings(): Record<string, unknown> {
  const user = db.select({ settings: users.settings }).from(users).get();
  try {
    return user?.settings ? (JSON.parse(user.settings) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readPlan(): Plan {
  const parsed = PlanSchema.safeParse(readSettings().mailerlitePlan);
  return parsed.success ? parsed.data : DEFAULT_PLAN;
}

function rawOfKind(kind: string) {
  return db
    .select({ externalId: importRawRecords.externalId, occurredAt: importRawRecords.occurredAt, payload: importRawRecords.payload })
    .from(importRawRecords)
    .where(and(eq(importRawRecords.connector, MAILERLITE_CONNECTOR), like(importRawRecords.externalId, `${kind}:%`)))
    .all()
    .map((r) => ({ ...r, data: JSON.parse(r.payload) as Record<string, any> }));
}

const rate = (r: unknown) =>
  r && typeof r === "object" && typeof (r as { float?: unknown }).float === "number" ? (r as { float: number }).float : null;
const num = (v: unknown) => (typeof v === "number" ? v : 0);

export async function newsletterRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/newsletter", async () => {
    const snapshots = rawOfKind("snapshot")
      .map((r) => ({ date: r.externalId.slice("snapshot:".length), subscribers: r.data.subscribers as Record<string, number> }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const signups = rawOfKind("signups")
      .map((r) => ({ month: String(r.data.month), total: num(r.data.total) }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const campaigns = rawOfKind("campaign")
      .map((r) => {
        const c = r.data;
        const s = (c.stats ?? {}) as Record<string, unknown>;
        return {
          id: String(c.id),
          sentAt: r.occurredAt,
          name: String(c.name ?? ""),
          subject: String(c.emails?.[0]?.subject ?? c.name ?? ""),
          sent: num(s.sent),
          opens: num(s.unique_opens_count ?? s.opens_count),
          openRate: rate(s.open_rate),
          clicks: num(s.unique_clicks_count ?? s.clicks_count),
          clickRate: rate(s.click_rate),
          clickToOpenRate: rate(s.click_to_open_rate),
          unsubscribes: num(s.unsubscribes_count),
        };
      })
      .sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)));

    // Campaign emails sent in the current calendar month (UTC). Automations
    // would add to this, but the account has none.
    const thisMonth = new Date().toISOString().slice(0, 7);
    const emailsThisMonth = campaigns
      .filter((c) => c.sentAt?.startsWith(thisMonth))
      .reduce((sum, c) => sum + c.sent, 0);

    const lastSync = db
      .select({ status: syncJobs.status, completedAt: syncJobs.completedAt, errorMessage: syncJobs.errorMessage })
      .from(syncJobs)
      .where(eq(syncJobs.connector, MAILERLITE_CONNECTOR))
      .orderBy(desc(syncJobs.createdAt), desc(syncJobs.id))
      .get();

    return {
      plan: readPlan(),
      latest: snapshots.at(-1) ?? null,
      snapshots,
      signups,
      campaigns,
      emailsThisMonth,
      lastSync: lastSync ?? null,
    };
  });

  app.put("/newsletter/plan", async (req, reply) => {
    const body = PlanSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid plan details" });
    const user = db.select({ id: users.id }).from(users).get();
    if (!user) return reply.code(404).send({ error: "User not found" });
    const settings = { ...readSettings(), mailerlitePlan: body.data };
    db.update(users)
      .set({ settings: JSON.stringify(settings), updatedAt: new Date().toISOString() })
      .where(eq(users.id, user.id))
      .run();
    return { plan: body.data };
  });
}

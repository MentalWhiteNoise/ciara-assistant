// Pure helpers for the MailerLite download: date parsing and trimming API
// records down to what Ciara keeps. No network, no database — unit-tested.

/** MailerLite dates look like "2022-07-26 15:07:52" with no zone. Treated as UTC
 *  (unverified — check against the dashboard on the first real download). */
export function mlDate(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Keep only what Ciara uses from a campaign. */
export function trimCampaign(c: Record<string, unknown>) {
  const emails = Array.isArray(c.emails) ? (c.emails as Record<string, unknown>[]) : [];
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    status: c.status,
    created_at: c.created_at,
    scheduled_for: c.scheduled_for,
    started_at: c.started_at,
    finished_at: c.finished_at,
    stats: c.stats,
    emails: emails.map((e) => ({ id: e.id, subject: e.subject, stats: e.stats })),
  };
}

export function trimAutomation(a: Record<string, unknown>) {
  return {
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    emails_count: a.emails_count,
    created_at: a.created_at,
    stats: a.stats,
  };
}

export function trimGroup(g: Record<string, unknown>) {
  return {
    id: g.id,
    name: g.name,
    active_count: g.active_count,
    unsubscribed_count: g.unsubscribed_count,
    unconfirmed_count: g.unconfirmed_count,
    bounced_count: g.bounced_count,
    junk_count: g.junk_count,
    sent_count: g.sent_count,
  };
}

/** Months to count signups for, newest first, as [YYYY-MM, firstDay, lastDay]. */
export function signupMonths(now: Date, count: number): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (let i = 0; i < count; i++) {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    out.push([ymd(first).slice(0, 7), ymd(first), ymd(last)]);
  }
  return out;
}

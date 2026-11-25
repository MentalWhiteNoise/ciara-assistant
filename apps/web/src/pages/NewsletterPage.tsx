// NewsletterPage — MailerLite list growth, campaign results, and plan limits.
//
// Everything shown comes from the stats the MailerLite download stored
// (Settings → Integrations → MailerLite). Ciara only ever has COUNTS — no
// subscriber names or email addresses. "Update stats" re-reads them from
// MailerLite (a handful of read-only requests).
//
// Charts are plain SVG (no chart library): we measure the container width
// with a ResizeObserver and draw to that size, so text never stretches.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

interface Plan {
  name: string;
  subscriberLimit: number;
  emailLimit: number;
  annualCost: number;
  nextPaymentDue: string;
}

interface Campaign {
  id: string;
  sentAt: string | null;
  subject: string;
  sent: number;
  opens: number;
  openRate: number | null;
  clicks: number;
  clickRate: number | null;
  clickToOpenRate: number | null;
  unsubscribes: number;
}

interface NewsletterData {
  plan: Plan;
  latest: { date: string; subscribers: Record<string, number> } | null;
  signups: { month: string; total: number }[];
  campaigns: Campaign[];
  emailsThisMonth: number;
  lastSync: { status: string; completedAt: string | null; errorMessage: string | null } | null;
}

const fmtInt = (n: number) => n.toLocaleString("en-US");
const fmtPct = (r: number | null) => (r == null ? "—" : `${(r * 100).toFixed(1)}%`);
const fmtMoney = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

// Single-series charts: one accent hue (indigo-500), recessive gray grid.
const SERIES = "#6366f1";
const SERIES_AREA = "rgba(99, 102, 241, 0.10)";

export default function NewsletterPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["newsletter"],
    queryFn: () => apiFetch<NewsletterData>("/api/newsletter"),
  });

  // Sync status polling while an update runs.
  const sync = useQuery({
    queryKey: ["sync", "mailerlite"],
    queryFn: () => apiFetch<{ jobs: { status: string }[] }>("/api/sync/mailerlite"),
    refetchInterval: (q) => (q.state.data?.jobs[0]?.status === "running" ? 2000 : false),
  });
  const running = sync.data?.jobs[0]?.status === "running";
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) queryClient.invalidateQueries({ queryKey: ["newsletter"] });
    wasRunning.current = running;
  }, [running, queryClient]);

  const update = useMutation({
    mutationFn: () => apiFetch("/api/sync/mailerlite", { method: "POST", body: JSON.stringify({ mode: "incremental" }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sync", "mailerlite"] }),
  });

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (error || !data) return <p className="text-sm text-red-600">{(error as Error)?.message ?? "Could not load"}</p>;

  // "On the list" by signup month = running total of signups. It counts people
  // still in the account today, so it's the list's shape, not an exact history.
  let running_total = 0;
  const cumulative = data.signups.map((s) => ({ month: s.month, value: (running_total += s.total), added: s.total }));
  const firstActive = data.signups.findIndex((s) => s.total > 0);
  const sinceStart = firstActive >= 0 ? cumulative.slice(firstActive) : cumulative;
  const signupBars = firstActive >= 0 ? data.signups.slice(firstActive) : data.signups;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Newsletter</h1>
          <p className="text-sm text-gray-500 mt-1">
            MailerLite list growth and campaign results. Counts only — Ciara never downloads subscriber names or emails.
          </p>
        </div>
        <div className="text-right">
          <button
            onClick={() => update.mutate()}
            disabled={running || update.isPending}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white"
          >
            {running ? "Updating…" : "Update stats"}
          </button>
          <p className="text-xs text-gray-400 mt-1">
            {data.lastSync?.status === "failed"
              ? <span className="text-red-600">Last update failed: {data.lastSync.errorMessage}</span>
              : <>Last updated {fmtDate(data.lastSync?.completedAt ?? null)}</>}
          </p>
          {update.error && <p className="text-xs text-red-600 mt-1">{(update.error as Error).message}</p>}
        </div>
      </div>

      {!data.latest ? (
        <p className="text-sm text-gray-600">
          No stats yet. Connect MailerLite in <Link to="/settings" className="text-indigo-600 hover:underline">Settings → Integrations</Link> and download stats.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <LimitTile
              label="Active subscribers"
              value={data.latest.subscribers.active ?? 0}
              limit={data.plan.subscriberLimit}
              note={`${fmtInt(data.latest.subscribers.unsubscribed ?? 0)} unsubscribed · ${fmtInt((data.latest.subscribers.bounced ?? 0) + (data.latest.subscribers.junk ?? 0))} bounced`}
              warnText="Close to the plan limit. Going over likely means a higher price at renewal."
            />
            <LimitTile
              label="Emails sent this month"
              value={data.emailsThisMonth}
              limit={data.plan.emailLimit}
              note="Campaigns sent this calendar month"
              warnText="Close to the plan's email limit."
            />
            <PlanTile plan={data.plan} />
          </div>

          <ChartCard
            title="On the list, by signup month"
            subtitle="Running total of everyone still in the account, by the month they joined (includes unsubscribed and bounced)."
          >
            <MonthlyChart
              kind="line"
              data={sinceStart.map((c) => ({ month: c.month, value: c.value }))}
              tooltip={(i) => (
                <>
                  <div className="font-medium">{monthLabel(sinceStart[i].month)}</div>
                  <div>{fmtInt(sinceStart[i].value)} on the list</div>
                  <div className="text-gray-500">+{fmtInt(sinceStart[i].added)} joined</div>
                </>
              )}
            />
          </ChartCard>

          <ChartCard title="New signups per month" subtitle="People who joined in each month and are still in the account.">
            <MonthlyChart
              kind="bar"
              data={signupBars.map((s) => ({ month: s.month, value: s.total }))}
              tooltip={(i) => (
                <>
                  <div className="font-medium">{monthLabel(signupBars[i].month)}</div>
                  <div>{fmtInt(signupBars[i].total)} joined</div>
                </>
              )}
            />
          </ChartCard>

          <CampaignTable campaigns={data.campaigns} />
        </>
      )}
    </div>
  );
}

// ── Tiles ─────────────────────────────────────────────────────────────────────

function LimitTile({ label, value, limit, note, warnText }: {
  label: string; value: number; limit: number; note: string; warnText: string;
}) {
  const share = limit > 0 ? value / limit : 0;
  const warn = share >= 0.9;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">
        {fmtInt(value)} <span className="text-sm font-normal text-gray-500">of {fmtInt(limit)}</span>
      </p>
      <div
        className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden"
        role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={value} aria-label={label}
      >
        <div className={`h-full rounded-full ${warn ? "bg-amber-500" : "bg-indigo-500"}`} style={{ width: `${Math.min(100, share * 100)}%` }} />
      </div>
      <p className="mt-2 text-xs text-gray-500">{note} · {Math.round(share * 100)}% used</p>
      {warn && <p className="mt-1 text-xs text-amber-700">⚠ {warnText}</p>}
    </div>
  );
}

function PlanTile({ plan }: { plan: Plan }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(plan);
  const save = useMutation({
    mutationFn: () => apiFetch("/api/newsletter/plan", { method: "PUT", body: JSON.stringify(form) }),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["newsletter"] });
    },
  });
  const days = Math.ceil((new Date(plan.nextPaymentDue + "T00:00:00").getTime() - Date.now()) / 86_400_000);
  const input = "w-full px-2 py-1 rounded border border-gray-300 text-sm";

  if (editing) {
    const field = (key: keyof Plan, label: string, type: "text" | "number" | "date") => (
      <label className="block text-xs text-gray-600">
        {label}
        <input
          type={type}
          step={key === "annualCost" ? "0.01" : undefined}
          value={String(form[key])}
          onChange={(e) => setForm((f) => ({ ...f, [key]: type === "number" ? Number(e.target.value) : e.target.value }))}
          className={input}
        />
      </label>
    );
    return (
      <form className="bg-white rounded-xl border border-gray-200 p-4 space-y-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {field("name", "Plan name", "text")}
        {field("subscriberLimit", "Subscriber limit", "number")}
        {field("emailLimit", "Email limit", "number")}
        {field("annualCost", "Annual cost ($)", "number")}
        {field("nextPaymentDue", "Next payment due", "date")}
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={save.isPending} className="text-sm font-medium text-indigo-600 hover:text-indigo-700">Save</button>
          <button type="button" onClick={() => { setEditing(false); setForm(plan); }} className="text-sm text-gray-500">Cancel</button>
        </div>
        {save.error && <p className="text-xs text-red-600">{(save.error as Error).message}</p>}
      </form>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-gray-500">MailerLite plan</p>
        <button onClick={() => { setForm(plan); setEditing(true); }} className="text-xs text-indigo-600 hover:underline">Edit</button>
      </div>
      <p className="mt-1 text-2xl font-semibold text-gray-900">
        {fmtMoney(plan.annualCost)} <span className="text-sm font-normal text-gray-500">/ year</span>
      </p>
      <p className="mt-2 text-xs text-gray-500">{plan.name} · about {fmtMoney(plan.annualCost / 12)} a month</p>
      <p className="mt-1 text-xs text-gray-500">
        Renews {fmtDate(plan.nextPaymentDue + "T00:00:00")}{days >= 0 && <> · in {fmtInt(days)} days</>}
      </p>
    </div>
  );
}

// ── Charts ────────────────────────────────────────────────────────────────────

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">{subtitle}</p>
      {children}
    </section>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A round axis maximum and ~4 tick steps. */
function niceScale(max: number) {
  if (max <= 0) return { top: 1, step: 1 };
  const rough = max / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough)!;
  return { top: Math.ceil(max / step) * step, step };
}

/** Bar with 4px rounded top corners, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function MonthlyChart({ kind, data, tooltip }: {
  kind: "line" | "bar";
  data: { month: string; value: number }[];
  tooltip: (i: number) => React.ReactNode;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 200;
  const m = { top: 10, right: 8, bottom: 24, left: 40 };
  const plotW = Math.max(0, width - m.left - m.right);
  const plotH = H - m.top - m.bottom;
  const n = data.length;
  const band = n > 0 ? plotW / n : 0;
  const { top, step } = niceScale(Math.max(0, ...data.map((d) => d.value)));
  const y = (v: number) => m.top + plotH - (v / top) * plotH;
  const cx = (i: number) => m.left + band * i + band / 2;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  // Label January of each year, plus the first month.
  const xLabels = data.map((d, i) => (i === 0 || d.month.endsWith("-01") ? i : -1)).filter((i) => i >= 0);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - box.left) / band);
    setHover(i >= 0 && i < n ? i : null);
  };

  const linePts = data.map((d, i) => `${cx(i)},${y(d.value)}`).join(" ");
  const areaPath = n ? `M${cx(0)},${y(0)}L${data.map((d, i) => `${cx(i)},${y(d.value)}`).join("L")}L${cx(n - 1)},${y(0)}Z` : "";
  const barW = Math.max(1, Math.min(28, band - 2)); // ≥2px gap between bars

  return (
    <div>
      <div ref={ref} className="relative w-full" style={{ height: H }}>
        {width > 0 && (
          <svg width={width} height={H} className="block" role="img" aria-label="Monthly chart">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke="#f3f4f6" />
                <text x={m.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="#9ca3af">{fmtInt(t)}</text>
              </g>
            ))}
            {xLabels.map((i) => (
              <text key={i} x={cx(i)} y={H - 6} textAnchor={i === 0 ? "start" : "middle"} fontSize={11} fill="#9ca3af">
                {i === 0 ? monthLabel(data[i].month) : data[i].month.slice(0, 4)}
              </text>
            ))}
            <line x1={m.left} x2={width - m.right} y1={y(0)} y2={y(0)} stroke="#e5e7eb" />

            {kind === "line" ? (
              <>
                <path d={areaPath} fill={SERIES_AREA} />
                <polyline points={linePts} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" />
              </>
            ) : (
              data.map((d, i) =>
                d.value > 0 ? (
                  <path
                    key={d.month}
                    d={barPath(cx(i) - barW / 2, y(d.value), barW, y(0) - y(d.value))}
                    fill={SERIES}
                    opacity={hover == null || hover === i ? 1 : 0.55}
                  />
                ) : null
              )
            )}

            {hover != null && (
              <>
                {kind === "line" && (
                  <>
                    <line x1={cx(hover)} x2={cx(hover)} y1={m.top} y2={y(0)} stroke="#d1d5db" />
                    <circle cx={cx(hover)} cy={y(data[hover].value)} r={4} fill={SERIES} stroke="#fff" strokeWidth={2} />
                  </>
                )}
              </>
            )}
            {/* Hit area — the whole plot, so hovering anywhere in a month's column works (touch too). */}
            <rect
              x={m.left} y={m.top} width={plotW} height={plotH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerDown={onMove}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
        )}
        {hover != null && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-800 shadow-sm whitespace-nowrap"
            style={{
              left: Math.min(Math.max(cx(hover), 70), width - 70),
              top: Math.max(0, y(data[hover].value) - 8),
              transform: "translate(-50%, -100%)",
            }}
          >
            {tooltip(hover)}
          </div>
        )}
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-gray-500">Show as table</summary>
        <div className="mt-2 max-h-60 overflow-y-auto">
          <table className="text-xs w-full max-w-xs">
            <tbody>
              {data.map((d) => (
                <tr key={d.month} className="border-b border-gray-50">
                  <td className="py-0.5 text-gray-600">{monthLabel(d.month)}</td>
                  <td className="py-0.5 text-right tabular-nums text-gray-900">{fmtInt(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ── Campaigns ─────────────────────────────────────────────────────────────────

function CampaignTable({ campaigns }: { campaigns: Campaign[] }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-900">Campaigns</h2>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">
        {campaigns.length} sent. Open and click rates are MailerLite's own (unique opens/clicks ÷ delivered). "Click-to-open" = of the people who opened, how many clicked.
      </p>
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              <th className="py-2 pr-3 font-medium">Sent</th>
              <th className="py-2 pr-3 font-medium">Subject</th>
              <th className="py-2 pr-3 font-medium text-right">Recipients</th>
              <th className="py-2 pr-3 font-medium text-right">Opened</th>
              <th className="py-2 pr-3 font-medium text-right">Clicked</th>
              <th className="py-2 pr-3 font-medium text-right">Click-to-open</th>
              <th className="py-2 font-medium text-right">Unsubs</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} className="border-b border-gray-100 last:border-0">
                <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{fmtDate(c.sentAt)}</td>
                <td className="py-2 pr-3 text-gray-900">{c.subject}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(c.sent)}</td>
                <td className="py-2 pr-3 text-right tabular-nums" title={`${fmtInt(c.opens)} people`}>{fmtPct(c.openRate)}</td>
                <td className="py-2 pr-3 text-right tabular-nums" title={`${fmtInt(c.clicks)} people`}>{fmtPct(c.clickRate)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(c.clickToOpenRate)}</td>
                <td className="py-2 text-right tabular-nums">{fmtInt(c.unsubscribes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

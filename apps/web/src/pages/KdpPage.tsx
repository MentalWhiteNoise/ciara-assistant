// KdpPage — import Amazon KDP reports and see where things stand.
//
// KDP has no API, so once a month the owner downloads up to three Excel reports
// from the KDP website and drops them here. The server works out which report
// each file is, imports it, and ticks off the matching reminder task.
//
// Sections:
//   • Status cards     — is each report up to date, and when is it next due
//   • Upload area      — drag & drop any number of KDP .xlsx files
//   • How-to           — exact click paths in KDP for each report
//   • Coverage grid    — which monthly statements are on file (for the backfill)
//   • Monthly totals   — statement earnings vs. what was actually paid out
//   • Import history

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiUpload } from "@/lib/api";

// ── Types (mirror apps/api/src/connectors/kdp) ─────────────────────────────────

type ReportState = "up_to_date" | "due" | "never";

interface ReportStatus {
  state: ReportState;
  lastImportedAt: string | null;
  detail: string;
  nextDue: string;
}

interface KdpStatusResponse {
  status: {
    today: string;
    latestClosedMonth: string;
    statement: ReportStatus;
    payments: ReportStatus & {
      failed: { salesPeriod: string; marketplace: string; accrued: number | null; currency: string }[];
    };
    orders: ReportStatus & { coveredThrough: string | null };
    coverage: { month: string; state: "final" | "provisional" | "missing" }[];
    missingMonths: string[];
  };
  months: {
    month: string;
    hasStatement: boolean;
    paidUnits: number;
    freeUnits: number;
    kenpPages: number;
    earningsUsd: number | null;
    earningsPartial: boolean;
    paidOutUsd: number | null;
    paymentDate: string | null;
  }[];
  imports: {
    id: string;
    reportType: "payments" | "statement" | "orders";
    originalName: string;
    coverage: string | null;
    rowsImported: number;
    transactionsCreated: number;
    warnings: string[];
    importedAt: string;
  }[];
}

interface ImportResult {
  fileName: string;
  ok: boolean;
  duplicate?: boolean;
  reportType?: string;
  summary?: string;
  warnings: string[];
  error?: string;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const int = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n));

function monthLabel(month: string, style: "long" | "short" = "long") {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: style, year: "numeric" });
}

function dateLabel(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const REPORT_LABEL: Record<string, string> = {
  payments: "Payments",
  statement: "Monthly statement",
  orders: "Orders (daily)",
};

// ── Small UI pieces ────────────────────────────────────────────────────────────

function Badge({ state, optional }: { state: ReportState; optional?: boolean }) {
  const map: Record<ReportState, [string, string]> = {
    up_to_date: ["Up to date", "bg-green-100 text-green-700"],
    due: [optional ? "Ready (optional)" : "Due now", optional ? "bg-gray-100 text-gray-600" : "bg-amber-100 text-amber-800"],
    never: [optional ? "Not imported (optional)" : "Not imported yet", optional ? "bg-gray-100 text-gray-600" : "bg-red-100 text-red-700"],
  };
  const [text, cls] = map[state];
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{text}</span>;
}

function StatusCard({
  title, subtitle, status, optional,
}: {
  title: string; subtitle: string; status: ReportStatus; optional?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="text-xs text-gray-400">{subtitle}</p>
        </div>
        <Badge state={status.state} optional={optional} />
      </div>
      <p className="text-sm text-gray-600">{status.detail}</p>
      <div className="mt-auto pt-2 border-t border-gray-100 flex justify-between text-xs text-gray-500">
        <span>Last import: {dateLabel(status.lastImportedAt)}</span>
        <span>
          Next: {status.state === "up_to_date" ? dateLabel(status.nextDue) : <strong className="text-gray-700">now</strong>}
        </span>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <span className="text-sm text-gray-700">{children}</span>
    </li>
  );
}

function Path({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-gray-900 bg-gray-100 px-1.5 py-0.5 rounded">{children}</span>;
}

function HowTo({
  title, tag, defaultOpen, children,
}: {
  title: string; tag: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group bg-white rounded-xl border border-gray-200">
      <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900">{title}</span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{tag}</span>
          <span className="text-gray-400 group-open:rotate-90 transition-transform">›</span>
        </span>
      </summary>
      <div className="px-4 pb-4 space-y-3">{children}</div>
    </details>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">{children}</p>;
}

// ── Upload area ────────────────────────────────────────────────────────────────

function UploadArea() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);

  const upload = useMutation({
    mutationFn: (files: File[]) => {
      const form = new FormData();
      files.forEach((f) => form.append("files", f, f.name));
      return apiUpload<{ results: ImportResult[] }>("/api/kdp/import", form);
    },
    onSuccess: (data) => {
      setResults(data.results);
      // Imports can add transactions and tick off reminder tasks.
      for (const key of ["kdp-status", "transactions", "tasks", "checklists"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (err: Error) => setResults([{ fileName: "Upload", ok: false, warnings: [], error: err.message }]),
  });

  const send = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length) upload.mutate(files);
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); send(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={[
          "rounded-xl border-2 border-dashed px-6 py-8 text-center cursor-pointer transition-colors",
          dragging ? "border-indigo-500 bg-indigo-50" : "border-gray-300 bg-white hover:border-indigo-400",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          className="hidden"
          onChange={(e) => { send(e.target.files); e.target.value = ""; }}
        />
        {upload.isPending ? (
          <p className="text-sm text-indigo-600 font-medium">Importing…</p>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-800">Drop KDP report files here, or click to choose</p>
            <p className="text-xs text-gray-500 mt-1">
              Any of the three reports, as many files as you like at once (.xlsx, straight from KDP — don't open and re-save them).
              Ciara works out which report each file is. Uploading the same report twice is harmless.
            </p>
          </>
        )}
      </div>

      {results.length > 0 && (
        <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {results.map((r, i) => (
            <li key={i} className="px-4 py-3">
              <div className="flex items-start gap-2">
                <span className={r.ok ? (r.duplicate ? "text-gray-400" : "text-green-600") : "text-red-600"}>
                  {r.ok ? (r.duplicate ? "=" : "✓") : "✕"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900">{r.ok ? r.summary : r.error}</p>
                  <p className="text-xs text-gray-400 truncate">{r.fileName}</p>
                  {r.warnings.map((w, j) => (
                    <p key={j} className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1 mt-1.5">⚠ {w}</p>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Coverage grid ──────────────────────────────────────────────────────────────

function CoverageGrid({ status }: { status: KdpStatusResponse["status"] }) {
  if (status.coverage.length === 0) {
    return (
      <p className="text-sm text-gray-500 bg-white rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center">
        Import the Payments report first — it tells Ciara how far back your KDP history goes, and this grid will show which
        monthly statements to download.
      </p>
    );
  }
  const byMonth = new Map(status.coverage.map((c) => [c.month, c.state]));
  const firstYear = Number(status.coverage[0].month.slice(0, 4));
  const lastYear = Number(status.today.slice(0, 4));
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i).reverse();
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const cellClass = (month: string) => {
    const state = byMonth.get(month);
    if (state === "final") return "bg-green-500 text-white";
    if (state === "provisional") return "bg-amber-300 text-amber-900";
    if (state === "missing") return "bg-white text-red-600 border border-red-300";
    return "bg-gray-50 text-gray-300"; // before history / not ready yet
  };
  const cellTitle = (month: string) => {
    const state = byMonth.get(month);
    if (state === "final") return `${monthLabel(month)}: imported`;
    if (state === "provisional") return `${monthLabel(month)}: imported before KDP finalized it — download again`;
    if (state === "missing") return `${monthLabel(month)}: not imported yet`;
    return month > status.latestClosedMonth ? `${monthLabel(month)}: not ready yet` : "";
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr>
            <th />
            {MONTHS.map((m) => <th key={m} className="font-medium text-gray-400 px-0.5 pb-1">{m}</th>)}
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y}>
              <td className="pr-2 font-medium text-gray-500">{y}</td>
              {MONTHS.map((_, i) => {
                const month = `${y}-${String(i + 1).padStart(2, "0")}`;
                const state = byMonth.get(month);
                return (
                  <td key={month} className="p-0.5">
                    <div title={cellTitle(month)} className={`w-8 h-7 rounded flex items-center justify-center ${cellClass(month)}`}>
                      {state === "final" ? "✓" : state === "provisional" ? "!" : state === "missing" ? "·" : ""}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-500" /> Imported</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-300" /> Download again (KU earnings weren't final)</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border border-red-300" /> Missing</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-50 border border-gray-200" /> Not ready yet</span>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function KdpPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["kdp-status"],
    queryFn: () => apiFetch<KdpStatusResponse>("/api/kdp/status"),
  });

  const status = data?.status;
  const closedLabel = status ? monthLabel(status.latestClosedMonth) : "last month";
  const missingCount = status?.missingMonths.length ?? 0;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Amazon KDP royalties</h1>
        <p className="text-sm text-gray-500 mt-1 max-w-3xl">
          KDP has no way for apps to connect directly, so once a month you download a few reports from the KDP website and
          drop them below. Ciara does the rest: payouts become income transactions, the monthly to-do list ticks itself off,
          per-book numbers show up here, and a day-by-day sales history builds up for comparing against events.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">Couldn't load KDP status: {(error as Error).message}</p>}

      {/* Status cards */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Where things stand</h2>
        {isLoading || !status ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => <div key={i} className="h-36 bg-white rounded-xl border border-gray-200 animate-pulse" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatusCard title="Payments" subtitle="Money actually paid to you · monthly" status={status.payments} />
              <StatusCard title="Monthly statement" subtitle="Earnings per book, incl. Kindle Unlimited · monthly" status={status.statement} />
              <StatusCard title="Orders" subtitle="Daily sales by order date, for event analysis · monthly" status={status.orders} />
            </div>
            {status.payments.failed.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
                <p className="font-medium">KDP reports {status.payments.failed.length === 1 ? "a payout" : "payouts"} that didn't go through:</p>
                <ul className="list-disc ml-5 mt-1">
                  {status.payments.failed.map((f) => (
                    <li key={`${f.salesPeriod}-${f.marketplace}`}>
                      {f.marketplace}, {monthLabel(f.salesPeriod)} sales — {f.accrued ?? "?"} {f.currency}
                    </li>
                  ))}
                </ul>
                <p className="text-xs mt-1 text-red-700">
                  Usually a bank-detail problem; KDP retries in a later payment. If it's old and never showed up, check
                  the bank details in your KDP account settings, or contact KDP support. No income transaction is created for failed payouts.
                </p>
              </div>
            )}
          </>
        )}
      </section>

      {/* Upload */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Import reports</h2>
        <UploadArea />
      </section>

      {/* How-to */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">How to download each report</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Do all of them in one sitting <strong>between the 15th and 20th of each month</strong>. Ciara puts a
            "KDP reports" checklist on your task list on the 10th as a heads-up, and ticks each item off as you import it.
            Sign in at kdp.amazon.com and click <Path>Reports</Path> in the top menu first.
          </p>
        </div>

        <HowTo title="1. Payments report" tag="every month · required" defaultOpen>
          <ol className="space-y-2">
            <Step n={1}>In the Reports menu, under <Path>Statements</Path>, click <Path>Payments</Path>.</Step>
            <Step n={2}>Leave the period set to <Path>All Sales Periods</Path>.</Step>
            <Step n={3}>Click <Path>Download report</Path>, then drop the file above.</Step>
          </ol>
          <Tip>
            This is the money that actually reached the bank, so it's what your income and taxes are based on. Each paid
            payout becomes one income transaction under Royalties / Amazon KDP. KDP pays about 60 days after a month ends
            (e.g. August sales arrive around October 29), and pays each marketplace (.com, .co.uk, .de…) separately.
            The download always includes your full history, so there's never anything to backfill.
          </Tip>
        </HowTo>

        <HowTo title="2. Monthly statement (Prior Months' Royalties)" tag="every month · required" defaultOpen>
          <ol className="space-y-2">
            <Step n={1}>In the Reports menu, under <Path>Statements</Path>, click <Path>Prior Months' Royalties</Path>.</Step>
            <Step n={2}>
              Choose last month — right now that's <Path>{closedLabel}</Path>. Only pick a month that has <em>ended</em>.
            </Step>
            <Step n={3}>Click <Path>Download report</Path>, then drop the file above.</Step>
          </ol>
          <Tip>
            Wait until the <strong>15th</strong>: KDP doesn't calculate Kindle Unlimited page-read earnings for a month
            until about mid-way through the next one, and earlier downloads show them as "N/A". If you import one too
            early, Ciara flags it and the coverage grid below shows it in amber so you know to download it again.
          </Tip>
        </HowTo>

        <HowTo title="3. Orders report" tag="every month · required" defaultOpen>
          <ol className="space-y-2">
            <Step n={1}>In the Reports menu, click <Path>Orders</Path>.</Step>
            <Step n={2}>
              Set the date range from the <strong>1st of last month</strong> to <strong>today</strong>, and choose <Path>All books</Path>.
            </Step>
            <Step n={3}>Click <Path>Download report</Path>, then drop the file above.</Step>
          </ol>
          <Tip>
            Day-by-day sales, free downloads and Kindle Unlimited pages, with the date each paperback was actually
            ordered — this is what lets Ciara line sales up against events, promos and ads. Keep the range to{" "}
            <strong>two months or less</strong>: for longer ranges KDP sends monthly totals instead of daily ones, and Ciara
            will turn that file away. Overlapping ranges are fine — newer files replace older data for the same days. The
            money figures are estimates; the monthly statement is the official number. The <Path>KENP</Path> and{" "}
            <Path>Dashboard</Path> downloads produce this exact same file, so you only need one of the three.
          </Tip>
        </HowTo>

        <HowTo title="One-time catch-up: download your history" tag="once">
          <ol className="space-y-2">
            <Step n={1}>Import the Payments report first — that tells Ciara how far back your account goes.</Step>
            <Step n={2}>
              In <Path>Prior Months' Royalties</Path>, download a statement for each month marked missing in the grid below
              {missingCount > 0 ? ` (${missingCount} right now)` : ""}. Choose a month, download, choose the next, download…
            </Step>
            <Step n={3}>Select all the downloaded files at once and drop them above — up to 60 per batch.</Step>
          </ol>
          <ol className="space-y-2" start={4}>
            <Step n={4}>
              For daily history, download <Path>Orders</Path> in <strong>two-month pieces</strong> going back to your first
              sale (Jan 1 – Feb 28, Mar 1 – Apr 30, …) and drop them all in together.
            </Step>
          </ol>
          <Tip>
            KDP only gives day-by-day numbers for short ranges — a longer range comes back as monthly totals, which Ciara
            turns away (the statements already have those).
          </Tip>
        </HowTo>
      </section>

      {/* Coverage */}
      {status && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Monthly statements on file</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {status.coverage.length === 0
                ? ""
                : missingCount === 0
                  ? "Every month is imported. 🎉"
                  : `${missingCount} month${missingCount === 1 ? "" : "s"} still to download. Hover a square for details.`}
            </p>
          </div>
          <CoverageGrid status={status} />
        </section>
      )}

      {/* Monthly totals */}
      {data && data.months.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Month by month</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              "Earned" comes from the statement, converted to dollars with the exchange rates KDP used for your payouts.
              "Paid out" is what reached the bank for that month's sales, about two months later.
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Sales month</th>
                  <th className="text-right font-medium px-3 py-2">Sold</th>
                  <th className="text-right font-medium px-3 py-2">Free</th>
                  <th className="text-right font-medium px-3 py-2">KU pages</th>
                  <th className="text-right font-medium px-3 py-2">Earned</th>
                  <th className="text-right font-medium px-3 py-2">Paid out</th>
                  <th className="text-right font-medium px-4 py-2">Paid on</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.months.map((m) => (
                  <tr key={m.month}>
                    <td className="px-4 py-2 text-gray-900 whitespace-nowrap">{monthLabel(m.month, "short")}</td>
                    {m.hasStatement ? (
                      <>
                        <td className="px-3 py-2 text-right">{int(m.paidUnits)}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{int(m.freeUnits)}</td>
                        <td className="px-3 py-2 text-right">{int(m.kenpPages)}</td>
                        <td className="px-3 py-2 text-right" title={m.earningsPartial ? "Estimated — some currencies converted with a recent exchange rate, or KU earnings not final yet" : undefined}>
                          {m.earningsUsd === null ? "—" : `${m.earningsPartial ? "≈ " : ""}${usd(m.earningsUsd)}`}
                        </td>
                      </>
                    ) : (
                      <td colSpan={4} className="px-3 py-2 text-center text-xs text-gray-400">no statement imported</td>
                    )}
                    <td className="px-3 py-2 text-right font-medium text-green-700">
                      {m.paidOutUsd === null ? <span className="text-gray-400 font-normal">not yet</span> : usd(m.paidOutUsd)}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500 whitespace-nowrap">{dateLabel(m.paymentDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* History */}
      {data && data.imports.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Recent imports</h2>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {data.imports.map((i) => (
              <div key={i.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="text-gray-500 w-28 flex-shrink-0">{dateLabel(i.importedAt)}</span>
                <span className="font-medium text-gray-900">{REPORT_LABEL[i.reportType]}</span>
                <span className="text-gray-500">{i.coverage?.replace("..", " → ")}</span>
                <span className="text-xs text-gray-400 ml-auto">
                  {int(i.rowsImported)} rows{i.transactionsCreated ? ` · ${i.transactionsCreated} transactions` : ""}
                  {i.warnings.length ? ` · ${i.warnings.length} warning${i.warnings.length === 1 ? "" : "s"}` : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

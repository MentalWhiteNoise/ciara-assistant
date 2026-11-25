// ChasePage — the shared Chase credit card (personal + business spending).
//
// Two steps, so nothing surprising lands in the books:
//   1. Upload Chase's "Download account activity" CSVs. Rows are only STORED;
//      overlapping or repeated downloads are fine (each row is kept once).
//   2. Import: the preview shows what the stored rows will become; "Import"
//      creates the transactions. Most go to Review Imports, grouped by merchant.
//      Print-shop charges for orders already imported from email are linked to
//      those orders instead of being counted again.

import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiUpload } from "@/lib/api";

interface Preview {
  totals: {
    rows: number;
    charges: number; chargeAmount: number;
    refunds: number; refundAmount: number;
    fees: number; feeAmount: number;
    linked: number; linkedAmount: number;
    payments: number;
    needsReview: number;
    filedByRule: number;
    merchantsToReview: number;
  };
  alreadyImported: number;
  links: { date: string; amount: number; merchant: string; linkedTo: string; orderDate: string }[];
  unmatchedVendorCharges: { date: string; amount: number; merchant: string }[];
  feesWithoutCharge: number;
  firstDate: string | null;
  lastDate: string | null;
}

interface ChaseStatus {
  storedRows: number;
  months: { month: string; rows: number }[];
  imported: { confirmed: number; needs_review: number; personal: number; total: number; businessSpend: number };
  uploads: { fileName: string; startedAt: string; newRows: number; duplicateRows: number; firstDate: string; lastDate: string }[];
  preview: Preview;
}

interface UploadResult {
  fileName: string;
  ok: boolean;
  error?: string;
  rows?: number;
  newRows?: number;
  firstDate?: string | null;
  lastDate?: string | null;
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const monthLabel = (m: string) =>
  new Date(`${m}-15T12:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" });

export default function ChasePage() {
  const status = useQuery({ queryKey: ["chase-status"], queryFn: () => apiFetch<ChaseStatus>("/api/chase/status") });
  const s = status.data;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Chase credit card</h1>
        <p className="text-sm text-gray-500 mt-1">
          The shared card, with personal and business spending mixed. Charges go to{" "}
          <Link to="/review" className="text-indigo-600 underline">Review Imports</Link>, grouped by merchant. Decide a
          merchant once with "remember" ticked, and its future charges are filed automatically.
        </p>
      </div>

      <UploadArea />

      {s && s.preview.totals.rows > 0 && <ImportPanel preview={s.preview} />}

      {s && (
        <section className="rounded-lg border border-gray-200 p-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-900">Imported so far</h2>
          <p className="text-sm text-gray-700">
            {s.imported.total} transactions: {s.imported.confirmed} business, {s.imported.personal} personal,{" "}
            {s.imported.needs_review > 0 ? (
              <Link to="/review" className="text-amber-700 underline">{s.imported.needs_review} waiting for review</Link>
            ) : (
              "none waiting for review"
            )}
            . Business spending on this card so far: <b>{money(s.imported.businessSpend)}</b>
            <span className="text-gray-500"> (print orders linked to their invoices are counted under IngramSpark / 48HR).</span>
          </p>
        </section>
      )}

      {s && s.months.length > 0 && <Coverage months={s.months} />}
    </div>
  );
}

// ── Upload ────────────────────────────────────────────────────────────────────

function UploadArea() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);

  const upload = useMutation({
    mutationFn: (files: File[]) => {
      const form = new FormData();
      files.forEach((f) => form.append("files", f, f.name));
      return apiUpload<{ results: UploadResult[] }>("/api/chase/upload", form);
    },
    onSuccess: (data) => {
      setResults(data.results);
      queryClient.invalidateQueries({ queryKey: ["chase-status"] });
    },
    onError: (err: Error) => setResults([{ fileName: "Upload", ok: false, error: err.message }]),
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
          accept=".csv"
          multiple
          className="hidden"
          onChange={(e) => { send(e.target.files); e.target.value = ""; }}
        />
        {upload.isPending ? (
          <p className="text-sm text-indigo-600 font-medium">Reading…</p>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-800">Drop Chase activity CSVs here, or click to choose</p>
            <p className="text-xs text-gray-500 mt-1">
              On chase.com: the card account → Download account activity → CSV. Overlapping date ranges and repeated
              downloads are fine, and you don't need to rename anything. Uploading only stores the rows; you'll see a
              preview before anything is imported.
            </p>
          </>
        )}
      </div>

      {results.length > 0 && (
        <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {results.map((r, i) => (
            <li key={i} className="px-4 py-2 text-sm flex flex-wrap gap-x-3">
              <span className="font-medium text-gray-800">{r.fileName}</span>
              {r.ok ? (
                <span className="text-gray-600">
                  {r.rows} rows, {r.firstDate} → {r.lastDate}:{" "}
                  {r.newRows ? <b className="text-green-700">{r.newRows} new</b> : "nothing new"}
                  {r.rows! - r.newRows! > 0 && `, ${r.rows! - r.newRows!} already stored`}
                </span>
              ) : (
                <span className="text-red-600">{r.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Import preview ────────────────────────────────────────────────────────────

function ImportPanel({ preview: p }: { preview: Preview }) {
  const queryClient = useQueryClient();
  const [showLinks, setShowLinks] = useState(false);
  const run = useMutation({
    mutationFn: () => apiFetch<Preview>("/api/chase/import", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      for (const key of ["chase-status", "review-groups", "transactions"]) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
  const t = p.totals;

  return (
    <section className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">
          Ready to import: {t.rows} rows, {p.firstDate} → {p.lastDate}
        </h2>
        <button
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="rounded-md bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {run.isPending ? "Importing…" : "Import"}
        </button>
      </div>
      {run.isError && <p className="text-sm text-red-600">{(run.error as Error).message}</p>}

      <ul className="text-sm text-gray-700 space-y-1 list-disc pl-5">
        <li>
          <b>{t.charges}</b> charges ({money(t.chargeAmount)}) and <b>{t.refunds}</b> refunds ({money(t.refundAmount)}).{" "}
          <b>{t.needsReview}</b> will wait for review across <b>{t.merchantsToReview}</b> merchants
          {t.filedByRule > 0 && <>; {t.filedByRule} filed automatically by your payee rules</>}.
        </li>
        <li>
          <b>{t.fees}</b> foreign transaction fees ({money(t.feeAmount)}), each attached to its charge. They're decided along
          with it, so they won't show up in review on their own.
          {p.feesWithoutCharge > 0 && <> {p.feesWithoutCharge} couldn't be matched and will be reviewed separately.</>}
        </li>
        <li>
          <b>{t.linked}</b> print-shop charges ({money(t.linkedAmount)}) match orders already imported from email. They'll be
          linked, not counted again.{" "}
          <button onClick={() => setShowLinks((v) => !v)} className="text-indigo-600 underline text-xs">
            {showLinks ? "hide" : "show"}
          </button>
        </li>
        <li>{t.payments} card payments are skipped (paying the card isn't spending).</li>
      </ul>

      {showLinks && (
        <ul className="text-xs text-gray-600 pl-5 space-y-0.5">
          {p.links.map((l, i) => (
            <li key={i}>{l.date} {money(l.amount)} → {l.linkedTo} dated {l.orderDate}</li>
          ))}
        </ul>
      )}

      {p.unmatchedVendorCharges.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-1">
          <p>
            <b>{p.unmatchedVendorCharges.length} print-shop charges have no matching order</b> (
            {money(p.unmatchedVendorCharges.reduce((s, u) => s + u.amount, 0))}). Each could be an order whose email never
            arrived, a deposit, or an order whose total changed. They'll go to review with a note. Check them before marking
            them business, so nothing is counted twice.
          </p>
          <ul className="text-xs pl-5 list-disc">
            {p.unmatchedVendorCharges.map((u, i) => (
              <li key={i}>{u.date} {money(u.amount)} {u.merchant}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ── Coverage ──────────────────────────────────────────────────────────────────

function Coverage({ months }: { months: { month: string; rows: number }[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-900">Months on file</h2>
      <div className="flex flex-wrap gap-1.5">
        {months.map((m) => (
          <span key={m.month} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700" title={`${m.rows} rows`}>
            {monthLabel(m.month)} · {m.rows}
          </span>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        Chase's CSV only reaches back about two years. Earlier months will come from the PDF statements.
      </p>
    </section>
  );
}

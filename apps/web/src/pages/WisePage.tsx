// WisePage — Wise (money transfers), used mainly to pay other artists for
// commissioned art (marketing, book illustrations).
//
// Email stage: "Transfer sent" emails in the shared reports inbox are read
// (READ-ONLY) every 6 hours while the vault is unlocked. Each becomes an
// expense to the artist; the first payment to someone goes to the Review page
// so its category is chosen once and remembered.
//
// Planned: Wise's read-only API (personal token, US accounts) as the main
// source; transfers are matched by Wise's transfer number, so nothing doubles.

import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { InboxScan } from "@/components/inbox/InboxScan";

interface WiseStatus {
  gmailReady: boolean;
  checking: boolean;
  lastCheck: { startedAt: string | null; status: string; error: string | null; problems: string[] } | null;
  transfers: {
    id: string;
    occurredAt: string;
    amount: number;
    currency: string;
    payee: string | null;
    referenceId: string | null;
    reviewStatus: "confirmed" | "needs_review" | "personal";
    category: string | null;
  }[];
  readyToImport: number;
  pausedTransfers: { transferNumber: string; date: string | null; summary: string }[];
}

interface CheckResult {
  sync: { emailsSeen: number };
  imported: { totals: { transfers: number; amount: number; needsReview: number } };
}

const money = (n: number, currency = "USD") => n.toLocaleString("en-US", { style: "currency", currency });
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

export default function WisePage() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["wise-status"], queryFn: () => apiFetch<WiseStatus>("/api/wise/status") });
  const check = useMutation({
    mutationFn: () => apiFetch<CheckResult>("/api/wise/check", { method: "POST", body: JSON.stringify({}) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["wise-status"] }),
  });
  const s = status.data;
  const toReview = s?.transfers.filter((t) => t.reviewStatus === "needs_review").length ?? 0;
  const problems = s?.lastCheck?.problems ?? [];

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Wise</h1>
        <p className="text-sm text-gray-500 mt-1">
          Payments to other artists. "Transfer sent" emails are picked up from the reports inbox automatically (every 6
          hours while you're logged in). Later, Wise's read-only API will bring in the full statement.
        </p>
      </div>

      <section className="rounded-lg border border-gray-200 p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-gray-700">
            Last inbox check: <b>{when(s?.lastCheck?.startedAt ?? null)}</b>
            {s?.lastCheck?.status === "failed" && <span className="text-red-600"> — failed: {s.lastCheck.error}</span>}
          </div>
          <button
            onClick={() => check.mutate()}
            disabled={check.isPending || !s?.gmailReady}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {check.isPending ? "Checking…" : "Check inbox now"}
          </button>
        </div>
        {s && !s.gmailReady && (
          <p className="text-sm text-amber-700">
            The reports inbox isn't available — unlock the vault or set it up in Settings → Integrations.
          </p>
        )}
        {check.isError && <p className="text-sm text-red-600">{(check.error as Error).message}</p>}
        {check.data && (
          <p className="text-sm text-green-700">
            Checked {check.data.sync.emailsSeen} Wise transfer email(s): imported {check.data.imported.totals.transfers} new
            transfer(s){check.data.imported.totals.transfers > 0 && ` (${money(check.data.imported.totals.amount)})`}.
          </p>
        )}
        {problems.length > 0 && (
          <ul className="text-sm text-amber-700 list-disc pl-5">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
        {toReview > 0 && (
          <p className="text-sm text-amber-700">
            {toReview} payment(s) need a category —{" "}
            <Link to="/review" className="underline">
              open Review Imports
            </Link>{" "}
            and pick one per artist (tick "remember" so later payments are done automatically).
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-900">Transfers {s && `— ${s.transfers.length}`}</h2>
        {status.isLoading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : s && s.transfers.length === 0 ? (
          <p className="text-sm text-gray-500">No transfers imported yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="py-1 pr-3">Date</th>
                  <th className="py-1 pr-3">To</th>
                  <th className="py-1 pr-3">Category</th>
                  <th className="py-1 pr-3">Transfer #</th>
                  <th className="py-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {s?.transfers.map((t) => (
                  <tr key={t.id}>
                    <td className="py-1 pr-3 whitespace-nowrap">{t.occurredAt}</td>
                    <td className="py-1 pr-3">{t.payee}</td>
                    <td className="py-1 pr-3 text-gray-600">
                      {t.reviewStatus === "needs_review" ? "needs review" : t.reviewStatus === "personal" ? "personal" : t.category ?? "—"}
                    </td>
                    <td className="py-1 pr-3">{t.referenceId}</td>
                    <td className="py-1 text-right whitespace-nowrap">{money(t.amount, t.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {s && s.pausedTransfers.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-900">Paused by Wise (no "Transfer sent" email for these)</h2>
          <ul className="text-sm text-gray-700 list-disc pl-5">
            {s.pausedTransfers.map((p) => (
              <li key={p.transferNumber}>
                {p.date?.slice(0, 10)} — #{p.transferNumber}: {p.summary}
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500">
            Nothing is recorded for these. If one was later sent under a new number, that transfer appears above.
          </p>
        </section>
      )}

      <InboxScan service="wise" label="Wise" folder="data/imports/wise/inbox" />
    </div>
  );
}

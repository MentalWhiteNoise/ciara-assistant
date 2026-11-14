// FortyEightHrPage — 48HR Books print orders, which arrive by email.
//
// 48HR has no API. Its emails are forwarded to the shared reports inbox and
// Ciara reads them (READ-ONLY) every 6 hours while the vault is unlocked.
// An order is imported once a confirmation shows it paid in full: one
// inventory-purchase expense, copies (incl. free ones) into home stock.
// Orders not paid in full yet are listed as waiting.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { InboxScan } from "@/components/inbox/InboxScan";

interface FortyEightStatus {
  gmailReady: boolean;
  checking: boolean;
  lastCheck: { startedAt: string | null; status: string; error: string | null; problems: string[] } | null;
  orders: { id: string; occurredAt: string; amount: number; description: string; referenceId: string | null }[];
  readyToImport: number;
  waiting: { orderNumber: string; title: string | null; reason: string; lastTotal: number | null }[];
  changedAfterImport: { orderNumber: string; imported: number; latest: number }[];
}

interface CheckResult {
  sync: { emailsSeen: number };
  imported: { totals: { orders: number; amount: number; copies: number } };
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

export default function FortyEightHrPage() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["48hr-status"], queryFn: () => apiFetch<FortyEightStatus>("/api/48hr/status") });
  const check = useMutation({
    mutationFn: () => apiFetch<CheckResult>("/api/48hr/check", { method: "POST", body: JSON.stringify({}) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["48hr-status"] }),
  });
  const s = status.data;
  const total = s?.orders.reduce((sum, o) => sum + o.amount, 0) ?? 0;
  const problems = s?.lastCheck?.problems ?? [];

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">48HR Books</h1>
        <p className="text-sm text-gray-500 mt-1">
          Print orders are picked up from the reports inbox automatically (every 6 hours while you're logged in). An
          order is recorded once 48HR's confirmation shows it paid in full.
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
            Checked {check.data.sync.emailsSeen} 48HR email(s): imported {check.data.imported.totals.orders} new order(s)
            {check.data.imported.totals.orders > 0 &&
              ` (${money(check.data.imported.totals.amount)}, ${check.data.imported.totals.copies} copies)`}
            .
          </p>
        )}
        {problems.length > 0 && (
          <ul className="text-sm text-amber-700 list-disc pl-5">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
      </section>

      {s && s.changedAfterImport.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-1">
          <h2 className="text-sm font-semibold text-amber-900">Changed after import — check these</h2>
          <ul className="text-sm text-amber-900 list-disc pl-5">
            {s.changedAfterImport.map((c) => (
              <li key={c.orderNumber}>
                Order {c.orderNumber}: recorded {money(c.imported)}, latest 48HR email says {money(c.latest)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-900">
          Print orders {s && `— ${s.orders.length} order(s), ${money(total)}`}
        </h2>
        {status.isLoading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : s && s.orders.length === 0 ? (
          <p className="text-sm text-gray-500">No orders imported yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="py-1 pr-3">Paid</th>
                  <th className="py-1 pr-3">Order</th>
                  <th className="py-1 pr-3">Books</th>
                  <th className="py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {s?.orders.map((o) => (
                  <tr key={o.id}>
                    <td className="py-1 pr-3 whitespace-nowrap">{o.occurredAt}</td>
                    <td className="py-1 pr-3">#{o.referenceId}</td>
                    <td className="py-1 pr-3">{o.description.replace(/^48HR Books print order #\d+ — /, "")}</td>
                    <td className="py-1 text-right whitespace-nowrap">{money(o.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-500">
          Each order is an expense under "Book Inventory Purchases" (Schedule C cost of goods, line 36) with 48HR's
          confirmation email attached. All copies, including the free ones, go into home inventory at total ÷ copies.
          48HR hardcovers are recorded as their own special edition.
        </p>
      </section>

      {s && s.waiting.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-900">Waiting</h2>
          <ul className="text-sm text-gray-700 list-disc pl-5">
            {s.waiting.map((w) => (
              <li key={w.orderNumber}>
                Order #{w.orderNumber}
                {w.title && ` (${w.title})`}: {w.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      <InboxScan service="48hr_books" label="48HR Books" folder="data/imports/48hr/inbox" />
    </div>
  );
}

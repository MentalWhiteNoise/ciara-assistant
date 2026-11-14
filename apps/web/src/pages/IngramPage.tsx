// IngramPage — IngramSpark data, which arrives by email.
//
// IngramSpark has no API. Its emails are forwarded to the shared reports inbox
// (Settings → Integrations → Reports inbox) and Ciara reads them from there,
// READ-ONLY, every 6 hours while the vault is unlocked.
//
// What's imported: AR invoices = author-copy print orders. Each becomes an
// inventory-purchase expense, with the copies added to home stock at their
// landed cost and the invoice PDF attached. Payment confirmations are kept for
// matching the credit-card statement later.
//
// The "Inbox scan" section is a read-only diagnostic listing every Ingram email.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { InboxScan } from "@/components/inbox/InboxScan";

// ── Types (mirror apps/api/src/routes/ingram.ts) ──

interface IngramStatus {
  gmailReady: boolean;
  checking: boolean;
  lastCheck: { startedAt: string | null; status: string; error: string | null; problems: string[] } | null;
  invoices: { id: string; occurredAt: string; amount: number; description: string; referenceId: string | null }[];
  waiting: number;
  payments: { chargedOn: string; cardLast4: string | null; total: number; invoices: { invoiceNumber: string; amount: number }[] }[];
}

interface CheckResult {
  sync: { emailsSeen: number; problems: string[] };
  imported: { totals: { invoices: number; amount: number; copies: number } };
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

export default function IngramPage() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["ingram-status"], queryFn: () => apiFetch<IngramStatus>("/api/ingram/status") });
  const check = useMutation({
    mutationFn: (full: boolean) =>
      apiFetch<CheckResult>("/api/ingram/check", { method: "POST", body: JSON.stringify({ full }) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["ingram-status"] }),
  });
  const s = status.data;
  const total = s?.invoices.reduce((sum, i) => sum + i.amount, 0) ?? 0;
  const problems = s?.lastCheck?.problems ?? [];

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">IngramSpark</h1>
        <p className="text-sm text-gray-500 mt-1">
          Print-order invoices are picked up from the reports inbox automatically (every 6 hours while you're logged
          in) and recorded as book inventory purchases. Nothing to download by hand.
        </p>
      </div>

      <section className="rounded-lg border border-gray-200 p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-gray-700">
            Last inbox check: <b>{when(s?.lastCheck?.startedAt ?? null)}</b>
            {s?.lastCheck?.status === "failed" && <span className="text-red-600"> — failed: {s.lastCheck.error}</span>}
          </div>
          <button
            onClick={() => check.mutate(false)}
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
        {s && s.waiting > 0 && <p className="text-sm text-amber-700">{s.waiting} invoice(s) found but not yet imported.</p>}
        {check.isError && <p className="text-sm text-red-600">{(check.error as Error).message}</p>}
        {check.data && (
          <p className="text-sm text-green-700">
            Checked {check.data.sync.emailsSeen} Ingram billing email(s): imported {check.data.imported.totals.invoices} new
            invoice(s)
            {check.data.imported.totals.invoices > 0 &&
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

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-900">
          Print orders {s && `— ${s.invoices.length} invoice(s), ${money(total)}`}
        </h2>
        {status.isLoading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : s && s.invoices.length === 0 ? (
          <p className="text-sm text-gray-500">No invoices imported yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="py-1 pr-3">Date</th>
                  <th className="py-1 pr-3">Invoice</th>
                  <th className="py-1 pr-3">Order</th>
                  <th className="py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {s?.invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="py-1 pr-3 whitespace-nowrap">{i.occurredAt}</td>
                    <td className="py-1 pr-3">{i.referenceId}</td>
                    <td className="py-1 pr-3">{i.description.replace(/^IngramSpark print order — /, "")}</td>
                    <td className="py-1 text-right whitespace-nowrap">{money(i.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-500">
          Each invoice is an expense under "Book Inventory Purchases" (Schedule C cost of goods, line 36) with the
          invoice PDF attached. The copies are added to home inventory at their landed cost: book price plus its share
          of sales tax and shipping.
        </p>
      </section>

      {s && s.payments.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-900">Card charges confirmed by Ingram</h2>
          <ul className="text-sm text-gray-700 list-disc pl-5">
            {s.payments.map((p, i) => (
              <li key={i}>
                {p.chargedOn}: {money(p.total)} on card ending {p.cardLast4 ?? "?"} — invoice(s){" "}
                {p.invoices.map((x) => x.invoiceNumber).join(", ")}
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500">
            Kept for matching the credit-card statement later — not counted as separate expenses.
          </p>
        </section>
      )}

      <InboxScan service="ingramspark" label="IngramSpark" folder="data/imports/ingram/inbox" />
    </div>
  );
}

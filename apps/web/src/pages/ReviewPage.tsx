// ReviewPage — decide whether imported transactions are business or personal.
//
// Imports (PayPal so far) can't tell a business purchase from a personal one,
// so those land here as "needs review". They're grouped by payee: deciding a
// group once (with "remember" on) saves a payee rule, so future payments to
// the same party are filed automatically.
//
// Personal transactions are kept (so they're never re-imported) but are
// excluded from reports and taxes.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

interface Tx {
  id: string;
  type: "sale" | "expense" | "refund" | "transfer";
  amount: number;
  currency: string;
  description: string;
  occurredAt: string;
  notes: string | null;
  categoryId: string | null;
}

interface Group {
  key: string;
  payee: string | null;
  counterpartyId: string | null;
  source: string;
  count: number;
  total: number;
  firstDate: string;
  lastDate: string;
  transactions: Tx[];
}

interface Category {
  id: string;
  name: string;
  type: string;
  parentId?: string | null;
}

const money = (n: number, currency = "USD") =>
  n.toLocaleString(undefined, { style: "currency", currency });

const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export default function ReviewPage() {
  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["review-groups"],
    queryFn: () => apiFetch<Group[]>("/api/review/groups"),
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<Category[]>("/api/categories"),
  });

  const totalCount = groups.reduce((s, g) => s + g.count, 0);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Review imports</h1>
        <p className="text-sm text-gray-500 mt-1">
          Imported payments that might be personal. Mark each payee as business (with a category) or
          personal. Leave "remember" on and future payments to the same payee are filed automatically.
          Until reviewed, these are left out of reports.
        </p>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {!isLoading && groups.length === 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center text-sm text-emerald-800">
          All caught up — nothing to review.
        </div>
      )}
      {groups.length > 0 && (
        <p className="text-sm text-gray-500 mb-3">
          {totalCount} transaction{totalCount === 1 ? "" : "s"} from {groups.length} payee{groups.length === 1 ? "" : "s"}
        </p>
      )}

      <div className="space-y-3">
        {groups.map((g) => (
          <GroupCard key={g.key} group={g} categories={categories} />
        ))}
      </div>
    </div>
  );
}

function GroupCard({ group, categories }: { group: Group; categories: Category[] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(!!group.counterpartyId);

  // Offer income categories for money in, expense categories for money out.
  const isIncome = group.transactions.every((t) => t.type === "sale");
  const options = useMemo(
    () => categories.filter((c) => c.type === (isIncome ? "income" : "expense")),
    [categories, isIncome]
  );
  const [categoryId, setCategoryId] = useState("");

  const decide = useMutation({
    mutationFn: (args: { ids: string[]; action: "business" | "personal"; remember: boolean }) =>
      apiFetch<{ updated: number; rulesSaved: number }>("/api/review/decide", {
        method: "POST",
        body: JSON.stringify({
          transactionIds: args.ids,
          action: args.action,
          categoryId: args.action === "business" && categoryId ? categoryId : undefined,
          remember: args.remember,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-groups"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  const allIds = group.transactions.map((t) => t.id);
  const samples = [...new Set(group.transactions.map((t) => t.description))].slice(0, 3);
  const currency = group.transactions[0]?.currency ?? "USD";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {group.payee ?? <span className="italic text-gray-500">No payee name</span>}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {group.count} × · {money(group.total, currency)} total · {fmtDate(group.firstDate)}
            {group.firstDate !== group.lastDate && <> – {fmtDate(group.lastDate)}</>} ·{" "}
            {isIncome ? "money in" : "money out"} · {group.source}
          </p>
          <p className="text-xs text-gray-400 mt-1 truncate">{samples.join(" · ")}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="px-2 py-1.5 rounded-lg border border-gray-300 text-sm max-w-[16rem]"
        >
          <option value="">Category (optional)…</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.parentId ? "  " : ""}{c.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => decide.mutate({ ids: allIds, action: "business", remember })}
          disabled={decide.isPending}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium rounded-lg"
        >
          Business
        </button>
        <button
          onClick={() => decide.mutate({ ids: allIds, action: "personal", remember })}
          disabled={decide.isPending}
          className="px-3 py-1.5 border border-gray-300 hover:bg-gray-50 text-sm text-gray-700 rounded-lg"
        >
          Personal
        </button>
        <label
          className={`flex items-center gap-1.5 text-xs ml-1 ${group.counterpartyId ? "text-gray-600" : "text-gray-300"}`}
          title={group.counterpartyId ? "" : "No stable payee ID — can't make a rule"}
        >
          <input
            type="checkbox"
            checked={remember}
            disabled={!group.counterpartyId}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Remember for this payee
        </label>
        <button onClick={() => setOpen((o) => !o)} className="ml-auto text-xs text-indigo-600 hover:text-indigo-700">
          {open ? "Hide" : "Show"} {group.count} transaction{group.count === 1 ? "" : "s"}
        </button>
      </div>
      {decide.error && <p className="text-xs text-red-600 mt-2">{(decide.error as Error).message}</p>}

      {open && (
        <ul className="mt-3 divide-y divide-gray-100 border-t border-gray-100">
          {group.transactions.map((t) => (
            <li key={t.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-gray-500 w-24 shrink-0">{fmtDate(t.occurredAt)}</span>
              <span className="flex-1 min-w-0 truncate text-gray-800" title={t.notes ?? ""}>{t.description}</span>
              <span className="tabular-nums text-gray-900">{money(t.amount, t.currency)}</span>
              <button
                onClick={() => decide.mutate({ ids: [t.id], action: "business", remember: false })}
                className="text-xs text-indigo-600 hover:text-indigo-800"
              >
                Business
              </button>
              <button
                onClick={() => decide.mutate({ ids: [t.id], action: "personal", remember: false })}
                className="text-xs text-gray-500 hover:text-gray-800"
              >
                Personal
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

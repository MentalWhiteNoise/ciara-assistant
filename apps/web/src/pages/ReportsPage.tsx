// ReportsPage — financial summary with date range filtering.
//
// Sections:
//   • Summary bar   — total income, expenses, net for the period
//   • Income by channel  — how much came in from each sales platform
//   • Expenses by category — where money went, IRS Schedule C aligned
//   • Monthly trend — month-by-month net for the year

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Transaction {
  id: string;
  type: string;
  amount: number;
  currency: string;
  description: string;
  categoryId?: string | null;
  channelId?: string | null;
  occurredAt: string;
}

interface Category {
  id: string;
  name: string;
  type: string;
  taxLine?: string | null;
}

interface Channel {
  id: string;
  name: string;
}

// ── Date range presets ─────────────────────────────────────────────────────────

type RangePreset = "this_month" | "last_month" | "this_year" | "last_year" | "custom";

function getPresetRange(preset: RangePreset): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed

  switch (preset) {
    case "this_month": {
      const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const last = new Date(y, m + 1, 0);
      return { from, to: last.toISOString().slice(0, 10) };
    }
    case "last_month": {
      const lm = m === 0 ? 11 : m - 1;
      const ly = m === 0 ? y - 1 : y;
      const from = `${ly}-${String(lm + 1).padStart(2, "0")}-01`;
      const last = new Date(ly, lm + 1, 0);
      return { from, to: last.toISOString().slice(0, 10) };
    }
    case "this_year":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "last_year":
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default:
      return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function pct(part: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

// Returns the 12 months in a given year as { label, from, to }
function monthsInYear(year: number) {
  return Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, "0");
    const from = `${year}-${m}-01`;
    const last = new Date(year, i + 1, 0);
    return {
      label: new Date(year, i, 1).toLocaleDateString("en-US", { month: "short" }),
      from,
      to: last.toISOString().slice(0, 10),
    };
  });
}

// ── Bar component ──────────────────────────────────────────────────────────────

function AmountBar({
  label,
  amount,
  maxAmount,
  color,
  sub,
}: {
  label: string;
  amount: number;
  maxAmount: number;
  color: string;
  sub?: string;
}) {
  const width = maxAmount > 0 ? (amount / maxAmount) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-700 truncate max-w-[60%]">{label}</span>
        <div className="flex items-center gap-3 flex-shrink-0">
          {sub && <span className="text-xs text-gray-400">{sub}</span>}
          <span className="font-medium text-gray-900 w-24 text-right">{fmt(amount)}</span>
        </div>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${width}%`, transition: "width 0.4s ease" }}
        />
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_year", label: "This year" },
  { value: "last_year", label: "Last year" },
  { value: "custom", label: "Custom" },
];

export default function ReportsPage() {
  const [preset, setPreset] = useState<RangePreset>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range = preset === "custom"
    ? { from: customFrom, to: customTo }
    : getPresetRange(preset);

  // Fetch transactions for the selected period
  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ["transactions", "report", range.from, range.to],
    queryFn: () =>
      apiFetch<Transaction[]>(
        `/api/transactions?from=${range.from}&to=${range.to}&limit=1000`
      ),
    enabled: !!(range.from && range.to),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<Category[]>("/api/categories"),
  });

  const { data: channels = [] } = useQuery({
    queryKey: ["channels"],
    queryFn: () => apiFetch<Channel[]>("/api/channels"),
  });

  // ── Aggregations ─────────────────────────────────────────────────────────────

  const sales = transactions.filter((t) => t.type === "sale");
  const expenses = transactions.filter((t) => t.type === "expense");
  const refunds = transactions.filter((t) => t.type === "refund");

  const totalIncome = sales.reduce((s, t) => s + t.amount, 0);
  const totalExpenses = expenses.reduce((s, t) => s + t.amount, 0);
  const totalRefunds = refunds.reduce((s, t) => s + t.amount, 0);
  const net = totalIncome - totalExpenses - totalRefunds;

  // Income by channel
  const incomeByChannel = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of sales) {
      const key = tx.channelId ?? "__none__";
      map.set(key, (map.get(key) ?? 0) + tx.amount);
    }
    return [...map.entries()]
      .map(([id, amount]) => ({
        id,
        name: channels.find((c) => c.id === id)?.name ?? "Unassigned",
        amount,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [sales, channels]);

  // Expenses by category
  const expensesByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of expenses) {
      const key = tx.categoryId ?? "__none__";
      map.set(key, (map.get(key) ?? 0) + tx.amount);
    }
    return [...map.entries()]
      .map(([id, amount]) => {
        const cat = categories.find((c) => c.id === id);
        return {
          id,
          name: cat?.name ?? "Uncategorized",
          taxLine: cat?.taxLine ?? null,
          amount,
        };
      })
      .sort((a, b) => b.amount - a.amount);
  }, [expenses, categories]);

  // Monthly trend (current year only, regardless of filter)
  const currentYear = new Date().getFullYear();
  const months = monthsInYear(currentYear);

  const monthlyTrend = useMemo(() => {
    return months.map(({ label, from, to }) => {
      const inRange = transactions.filter(
        (t) => t.occurredAt >= from && t.occurredAt <= to
      );
      const inc = inRange.filter((t) => t.type === "sale").reduce((s, t) => s + t.amount, 0);
      const exp = inRange.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
      return { label, income: inc, expenses: exp, net: inc - exp };
    });
  }, [transactions, months]);

  const maxMonthlyBar = Math.max(...monthlyTrend.map((m) => Math.max(m.income, m.expenses)));

  const maxChannelAmount = Math.max(...incomeByChannel.map((c) => c.amount), 0);
  const maxCategoryAmount = Math.max(...expensesByCategory.map((c) => c.amount), 0);

  const showTrend = preset === "this_year" || preset === "last_year";

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-400 mt-0.5">Financial summary</p>
        </div>
      </div>

      {/* Date range selector */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                preset === p.value
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <span className="text-gray-400 text-sm">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : transactions.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-200 py-20 text-center">
          <p className="text-gray-400 text-sm">No transactions in this period.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Income</p>
              <p className="text-2xl font-semibold text-green-600 mt-1.5">{fmt(totalIncome)}</p>
              <p className="text-xs text-gray-400 mt-1">{sales.length} sales</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Expenses</p>
              <p className="text-2xl font-semibold text-red-600 mt-1.5">{fmt(totalExpenses)}</p>
              <p className="text-xs text-gray-400 mt-1">{expenses.length} transactions</p>
            </div>
            {totalRefunds > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Refunds</p>
                <p className="text-2xl font-semibold text-amber-600 mt-1.5">{fmt(totalRefunds)}</p>
                <p className="text-xs text-gray-400 mt-1">{refunds.length} refunds</p>
              </div>
            )}
            <div className="bg-white rounded-xl border border-gray-200 p-5 lg:col-start-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Net</p>
              <p className={`text-2xl font-semibold mt-1.5 ${net >= 0 ? "text-gray-900" : "text-red-600"}`}>
                {fmt(net)}
              </p>
              <p className="text-xs text-gray-400 mt-1">Income − expenses</p>
            </div>
          </div>

          {/* Monthly trend (year view only) */}
          {showTrend && maxMonthlyBar > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Monthly trend</h2>
              <div className="flex items-end gap-1.5 h-32">
                {monthlyTrend.map(({ label, income, expenses }) => (
                  <div key={label} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full flex flex-col justify-end h-24 gap-0.5">
                      {income > 0 && (
                        <div
                          className="w-full bg-green-400 rounded-t"
                          style={{ height: `${(income / maxMonthlyBar) * 96}px` }}
                          title={`Income: ${fmt(income)}`}
                        />
                      )}
                      {expenses > 0 && (
                        <div
                          className="w-full bg-red-300 rounded-t"
                          style={{ height: `${(expenses / maxMonthlyBar) * 96}px` }}
                          title={`Expenses: ${fmt(expenses)}`}
                        />
                      )}
                    </div>
                    <span className="text-xs text-gray-400">{label}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-4 mt-3 text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-green-400" />Income
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-red-300" />Expenses
                </span>
              </div>
            </div>
          )}

          {/* Two-column: income by channel + expenses by category */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Income by channel */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Income by channel</h2>
              {incomeByChannel.length === 0 ? (
                <p className="text-sm text-gray-400">No sales in this period.</p>
              ) : (
                <div className="space-y-4">
                  {incomeByChannel.map((row) => (
                    <AmountBar
                      key={row.id}
                      label={row.name}
                      amount={row.amount}
                      maxAmount={maxChannelAmount}
                      color="bg-green-400"
                      sub={pct(row.amount, totalIncome)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Expenses by category */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Expenses by category</h2>
              {expensesByCategory.length === 0 ? (
                <p className="text-sm text-gray-400">No expenses in this period.</p>
              ) : (
                <div className="space-y-4">
                  {expensesByCategory.map((row) => (
                    <AmountBar
                      key={row.id}
                      label={row.name}
                      amount={row.amount}
                      maxAmount={maxCategoryAmount}
                      color="bg-red-300"
                      sub={pct(row.amount, totalExpenses)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

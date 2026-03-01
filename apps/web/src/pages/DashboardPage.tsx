// DashboardPage — home screen with live data.
// Shows financial summary, today's tasks, upcoming events, and recent transactions.

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuthStore } from "@/stores/auth.store";
import { apiFetch } from "@/lib/api";

// ── Date helpers ───────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

function monthRange() {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  // Last day of month
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const to = last.toISOString().slice(0, 10);
  return { from, to };
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmt(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function fmtDate(isoDate: string) {
  return new Date(isoDate.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface Transaction {
  id: string;
  type: string;
  amount: number;
  currency: string;
  description: string;
  categoryId?: string | null;
  occurredAt: string;
}

interface Task {
  id: string;
  title: string;
  priority: string;
  dueDate?: string | null;
  status: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  startAt: string;
  allDay: boolean;
  eventTypeId?: string | null;
}

interface EventType {
  id: string;
  name: string;
  color?: string | null;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color = "text-gray-900",
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  loading?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      {loading ? (
        <div className="h-8 mt-1.5 w-24 bg-gray-100 rounded animate-pulse" />
      ) : (
        <p className={`text-2xl font-semibold mt-1.5 ${color}`}>{value}</p>
      )}
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function Section({
  title,
  linkTo,
  linkLabel,
  children,
}: {
  title: string;
  linkTo?: string;
  linkLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
        {linkTo && (
          <Link to={linkTo} className="text-xs text-indigo-600 hover:underline font-medium">
            {linkLabel ?? "View all →"}
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-xl border border-dashed border-gray-200 py-8 text-center">
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
}

const PRIORITY_DOT: Record<string, string> = {
  low: "bg-gray-400",
  medium: "bg-blue-500",
  high: "bg-amber-500",
  urgent: "bg-red-500",
};

const TX_COLORS: Record<string, string> = {
  sale: "text-green-600",
  expense: "text-red-600",
  refund: "text-amber-600",
  transfer: "text-gray-500",
};
const TX_PREFIX: Record<string, string> = {
  sale: "+", expense: "−", refund: "−", transfer: "",
};

// ── Main page ──────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const { from: monthFrom, to: monthTo } = monthRange();

  // Month transactions → income / expenses / net
  const { data: monthTx = [], isLoading: txLoading } = useQuery({
    queryKey: ["transactions", "month", monthFrom, monthTo],
    queryFn: () => apiFetch<Transaction[]>(`/api/transactions?from=${monthFrom}&to=${monthTo}&limit=500`),
  });

  // Today's active tasks
  const { data: todayTasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ["tasks", "today-dash"],
    queryFn: () => apiFetch<Task[]>(`/api/tasks?status=active&date=${TODAY}`),
  });

  // All active tasks (for "Tasks due soon" — due in the next 7 days)
  const { data: activeTasks = [] } = useQuery({
    queryKey: ["tasks", "active-dash"],
    queryFn: () => apiFetch<Task[]>(`/api/tasks?status=active`),
  });

  // Upcoming events (next 21 days)
  const upcomingTo = addDays(TODAY, 21);
  const { data: upcomingEvents = [], isLoading: eventsLoading } = useQuery({
    queryKey: ["events", "upcoming", TODAY, upcomingTo],
    queryFn: () => apiFetch<CalendarEvent[]>(`/api/events?from=${TODAY}&to=${upcomingTo}`),
  });

  // Event types for color lookup
  const { data: eventTypes = [] } = useQuery({
    queryKey: ["event-types"],
    queryFn: () => apiFetch<EventType[]>(`/api/event-types`),
  });

  // ── Computed values ──────────────────────────────────────────────────────────

  const income = monthTx
    .filter((t) => t.type === "sale")
    .reduce((sum, t) => sum + t.amount, 0);

  const expenses = monthTx
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + t.amount, 0);

  const net = income - expenses;

  // Recent transactions: last 5 by date
  const recentTx = [...monthTx]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 5);

  // Tasks due in next 7 days (with a due date)
  const soon = addDays(TODAY, 7);
  const dueSoon = activeTasks
    .filter((t) => t.dueDate && t.dueDate >= TODAY && t.dueDate <= soon)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
    .slice(0, 5);

  const typeMap = Object.fromEntries(eventTypes.map((t) => [t.id, t]));

  const monthName = new Date().toLocaleDateString("en-US", { month: "long" });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Greeting */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">
          {greeting}{user?.displayName ? `, ${user.displayName}` : ""}
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label={`Income — ${monthName}`}
          value={txLoading ? "—" : fmt(income)}
          sub={txLoading ? undefined : `${monthTx.filter(t => t.type === "sale").length} sales`}
          color="text-green-600"
          loading={txLoading}
        />
        <StatCard
          label={`Expenses — ${monthName}`}
          value={txLoading ? "—" : fmt(expenses)}
          sub={txLoading ? undefined : `${monthTx.filter(t => t.type === "expense").length} transactions`}
          color="text-red-500"
          loading={txLoading}
        />
        <StatCard
          label="Net this month"
          value={txLoading ? "—" : fmt(net)}
          sub="Income − expenses"
          color={net >= 0 ? "text-gray-900" : "text-red-600"}
          loading={txLoading}
        />
        <StatCard
          label="Tasks today"
          value={tasksLoading ? "—" : String(todayTasks.length)}
          sub={todayTasks.length === 1 ? "item due" : "items due"}
          loading={tasksLoading}
        />
      </div>

      {/* Lower grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Recent transactions */}
        <Section title="Recent transactions" linkTo="/transactions" linkLabel="All transactions →">
          {txLoading ? (
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="px-4 py-3 flex justify-between">
                  <div className="h-4 w-40 bg-gray-100 rounded animate-pulse" />
                  <div className="h-4 w-16 bg-gray-100 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : recentTx.length === 0 ? (
            <EmptyCard message="No transactions yet. Add one in Money → Transactions." />
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              {recentTx.map((tx) => (
                <div key={tx.id} className="px-4 py-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-900 truncate">{tx.description}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{fmtDate(tx.occurredAt)}</p>
                  </div>
                  <span className={`text-sm font-medium ml-4 flex-shrink-0 ${TX_COLORS[tx.type] ?? "text-gray-600"}`}>
                    {TX_PREFIX[tx.type]}{fmt(tx.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Upcoming events */}
        <Section title="Upcoming events" linkTo="/calendar" linkLabel="Calendar →">
          {eventsLoading ? (
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="px-4 py-3 flex gap-3 items-center">
                  <div className="w-1 h-8 bg-gray-100 rounded animate-pulse" />
                  <div className="h-4 w-48 bg-gray-100 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : upcomingEvents.length === 0 ? (
            <EmptyCard message="No upcoming events. Add one in Calendar." />
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              {upcomingEvents.slice(0, 5).map((ev) => {
                const evType = ev.eventTypeId ? typeMap[ev.eventTypeId] : null;
                const color = evType?.color ?? "#6366f1";
                const isToday = ev.startAt.slice(0, 10) === TODAY;
                return (
                  <div key={ev.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{ev.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {isToday ? "Today" : fmtDate(ev.startAt)}
                        {!ev.allDay && ` · ${ev.startAt.slice(11, 16)}`}
                        {evType && ` · ${evType.name}`}
                      </p>
                    </div>
                    {isToday && (
                      <span className="flex-shrink-0 text-xs font-medium bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                        Today
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* Tasks due soon */}
        <Section title="Tasks due this week" linkTo="/tasks" linkLabel="All tasks →">
          {dueSoon.length === 0 ? (
            <EmptyCard message="No tasks due in the next 7 days." />
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              {dueSoon.map((task) => {
                const isToday = task.dueDate === TODAY;
                return (
                  <div key={task.id} className="px-4 py-3 flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[task.priority] ?? "bg-gray-400"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 truncate">{task.title}</p>
                    </div>
                    <span className={`text-xs flex-shrink-0 ${isToday ? "text-red-600 font-medium" : "text-gray-400"}`}>
                      {isToday ? "Today" : fmtDate(task.dueDate!)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* This month at a glance */}
        <Section title={`${monthName} at a glance`}>
          {txLoading ? (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex justify-between">
                  <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
                  <div className="h-4 w-16 bg-gray-100 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : monthTx.length === 0 ? (
            <EmptyCard message="No transactions this month yet." />
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              {/* Mini income/expense bar */}
              {income + expenses > 0 && (
                <div className="mb-4">
                  <div className="flex text-xs text-gray-500 justify-between mb-1">
                    <span>Income vs Expenses</span>
                    <span>{income > 0 ? Math.round((income / (income + expenses)) * 100) : 0}% income</span>
                  </div>
                  <div className="h-2 bg-red-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full"
                      style={{ width: `${income + expenses > 0 ? (income / (income + expenses)) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Total income</span>
                <span className="font-medium text-green-600">{fmt(income)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Total expenses</span>
                <span className="font-medium text-red-600">{fmt(expenses)}</span>
              </div>
              <div className="border-t border-gray-100 pt-3 flex justify-between text-sm font-semibold">
                <span className="text-gray-700">Net</span>
                <span className={net >= 0 ? "text-gray-900" : "text-red-600"}>{fmt(net)}</span>
              </div>
              <Link
                to="/reports"
                className="block text-center text-xs text-indigo-600 hover:underline font-medium pt-1"
              >
                Full report →
              </Link>
            </div>
          )}
        </Section>

      </div>
    </div>
  );
}

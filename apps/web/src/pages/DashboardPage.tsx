// DashboardPage — the home screen after login.
// Phase 1 skeleton: correct layout, stat cards, recent activity placeholder.
// Data fetching wired in when transaction/product APIs exist.

import { useAuthStore } from "@/stores/auth.store";

// Stat card component — used for the top summary row
function StatCard({
  label,
  value,
  sub,
  color = "text-gray-900",
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-semibold mt-1.5 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

// Section wrapper — consistent heading + content block
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-700 mb-3">{title}</h2>
      {children}
    </div>
  );
}

// Empty state — shown in sections that have no data yet
function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-xl border border-dashed border-gray-200 py-10 text-center">
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  // Greeting based on time of day
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Page header */}
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
          label="Income this month"
          value="—"
          sub="No transactions yet"
          color="text-green-600"
        />
        <StatCard
          label="Expenses this month"
          value="—"
          sub="No transactions yet"
          color="text-red-500"
        />
        <StatCard
          label="Net this month"
          value="—"
          sub="Income − expenses"
        />
        <StatCard
          label="Tasks due today"
          value="—"
          sub="No tasks yet"
        />
      </div>

      {/* Two-column lower section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Upcoming events">
          <EmptyState message="No events scheduled. Add one in the Calendar." />
        </Section>

        <Section title="Tasks due soon">
          <EmptyState message="No tasks yet. They'll appear here when added." />
        </Section>

        <Section title="Recent transactions">
          <EmptyState message="No transactions yet. Add one in Money → Transactions." />
        </Section>

        <Section title="Low inventory alerts">
          <EmptyState message="Inventory tracking not set up yet." />
        </Section>
      </div>
    </div>
  );
}

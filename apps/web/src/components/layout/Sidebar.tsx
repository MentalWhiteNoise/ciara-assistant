// Sidebar navigation — the persistent left panel shown to authenticated users.
// Nav items are grouped by area. Clicking triggers React Router navigation.

import { NavLink, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";

// NavLink from React Router applies an "active" class automatically
// when the current URL matches the `to` prop.

interface NavItem {
  label: string;
  to: string;
  icon: string; // text emoji — swapped for icons later
}

const NAV_GROUPS: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Workspace",
    items: [
      { label: "Dashboard", to: "/", icon: "▦" },
      { label: "Calendar", to: "/calendar", icon: "◫" },
      { label: "Tasks", to: "/tasks", icon: "◻" },
      { label: "Checklists", to: "/checklists", icon: "☑" },
    ],
  },
  {
    heading: "Money",
    items: [
      { label: "Transactions", to: "/transactions", icon: "⇄" },
      { label: "Expenses", to: "/expenses", icon: "↓" },
      { label: "Income", to: "/income", icon: "↑" },
    ],
  },
  {
    heading: "Catalog",
    items: [
      { label: "Products & Books", to: "/products", icon: "◈" },
      { label: "Inventory", to: "/inventory", icon: "▤" },
    ],
  },
  {
    heading: "Fulfillment",
    items: [
      { label: "Orders", to: "/orders", icon: "◧" },
    ],
  },
  {
    heading: "Reporting",
    items: [
      { label: "Reports", to: "/reports", icon: "◉" },
      { label: "Tax Prep", to: "/reports/tax", icon: "◎" },
    ],
  },
  {
    heading: "System",
    items: [{ label: "Settings", to: "/settings", icon: "◌" }],
  },
];

export default function Sidebar({ onClose }: { onClose?: () => void }) {
  const navigate = useNavigate();
  const { user, clearAuth } = useAuthStore();

  const logout = useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      clearAuth();
      navigate("/login");
    },
  });

  return (
    <aside className="w-56 flex-shrink-0 bg-gray-900 text-gray-300 flex flex-col h-screen">
      {/* Logo / app name */}
      <div className="px-4 py-5 border-b border-gray-800">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-indigo-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">C</span>
          </div>
          <span className="text-sm font-semibold text-white">Ciara</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.heading} className="mb-4">
            <p className="px-2 mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
              {group.heading}
            </p>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                onClick={onClose}
                className={({ isActive }) =>
                  [
                    "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors mb-0.5",
                    isActive
                      ? "bg-indigo-600 text-white"
                      : "text-gray-400 hover:bg-gray-800 hover:text-gray-200",
                  ].join(" ")
                }
              >
                <span className="text-base leading-none w-4 text-center">
                  {item.icon}
                </span>
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* User + logout */}
      <div className="border-t border-gray-800 px-3 py-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400 truncate">
            {user?.displayName ?? "Owner"}
          </span>
          <button
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-1 rounded"
            title="Lock app"
          >
            {logout.isPending ? "…" : "Lock"}
          </button>
        </div>
      </div>
    </aside>
  );
}

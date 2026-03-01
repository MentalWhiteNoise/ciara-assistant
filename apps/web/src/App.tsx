// App.tsx — root component. Defines the full route tree.
//
// Route structure:
//
//   /login          → LoginPage       (public)
//   /setup          → SetupPage       (public, first-run only)
//   /               → ProtectedRoute  → AppLayout → DashboardPage
//   /calendar       → ProtectedRoute  → AppLayout → PlaceholderPage
//   /tasks          → ProtectedRoute  → AppLayout → PlaceholderPage
//   ... etc
//
// AuthInitializer wraps the whole tree and silently attempts to restore
// the session on every page load using the httpOnly refresh cookie.

import { Routes, Route, Navigate } from "react-router-dom";

import AuthInitializer from "@/components/AuthInitializer";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/layout/AppLayout";

import SetupPage from "@/pages/SetupPage";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import ProductsPage from "@/pages/ProductsPage";
import TransactionsPage from "@/pages/TransactionsPage";
import TasksPage from "@/pages/TasksPage";
import CalendarPage from "@/pages/CalendarPage";
import ReportsPage from "@/pages/ReportsPage";
import PlaceholderPage from "@/pages/PlaceholderPage";

export default function App() {
  return (
    // AuthInitializer tries /auth/refresh on mount to restore a previous session
    <AuthInitializer>
      <Routes>
        {/* ── Public routes ──────────────────────────────────────────────── */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />

        {/* ── Protected routes — require authentication ───────────────────── */}
        {/* ProtectedRoute checks auth state; AppLayout renders sidebar+content */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            {/* Dashboard */}
            <Route path="/" element={<DashboardPage />} />

            {/* Calendar & Tasks */}
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/tasks" element={<TasksPage />} />

            {/* Money */}
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/expenses" element={<PlaceholderPage />} />
            <Route path="/income" element={<PlaceholderPage />} />

            {/* Catalog */}
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/inventory" element={<PlaceholderPage />} />

            {/* Reports */}
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/reports/tax" element={<PlaceholderPage />} />

            {/* Settings */}
            <Route path="/settings" element={<PlaceholderPage />} />
          </Route>
        </Route>

        {/* Catch-all → dashboard (which will redirect to login if not auth'd) */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthInitializer>
  );
}

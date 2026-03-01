// AppLayout — the shell that wraps all authenticated pages.
//
// On desktop (≥ 768px / md breakpoint): sidebar is always visible on the left.
// On mobile/tablet portrait (< md): sidebar hides off-screen; a hamburger button
// in the top header bar slides it in as an overlay drawer. Tapping the backdrop
// or any nav link closes it.
//
// Structure (desktop):
//   <div flex-row full-height>
//     <Sidebar />              ← always visible, static in flow
//     <main scrollable>
//       <Outlet />
//     </main>
//   </div>
//
// Structure (mobile):
//   <div full-height>
//     <backdrop />             ← dark overlay when drawer is open
//     <Sidebar />              ← fixed overlay, slides in/out
//     <div flex-col>
//       <header>☰ Ciara</header>
//       <main scrollable>
//         <Outlet />
//       </main>
//     </div>
//   </div>

import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">

      {/* Mobile backdrop — dims content behind the open drawer */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — fixed overlay on mobile, static in flow on desktop */}
      <div
        className={`
          fixed inset-y-0 left-0 z-30
          transition-transform duration-200 ease-in-out
          md:static md:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Right side: mobile header + scrollable page content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Mobile-only top bar with hamburger */}
        <header className="md:hidden flex items-center gap-3 h-12 px-4 bg-gray-900 border-b border-gray-800 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-300 hover:text-white transition-colors p-1 -ml-1"
            aria-label="Open navigation"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-indigo-500 rounded-md flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold">C</span>
            </div>
            <span className="text-sm font-semibold text-white">Ciara</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

    </div>
  );
}

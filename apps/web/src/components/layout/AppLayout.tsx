// AppLayout — the shell that wraps all authenticated pages.
// Renders sidebar on the left, page content on the right.
//
// Structure:
//   <div flex-row full-height>
//     <Sidebar />
//     <main scrollable>
//       <Outlet />   ← React Router renders the matched child route here
//     </main>
//   </div>
//
// <Outlet /> is a React Router concept — it's a placeholder that renders
// whatever child route is currently active. So if the URL is /transactions,
// the Outlet renders TransactionsPage inside this layout.

import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";

export default function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

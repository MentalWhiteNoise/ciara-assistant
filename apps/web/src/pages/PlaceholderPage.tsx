// Temporary placeholder — shown for pages not yet built.
// Replace with the real page component as each section is implemented.

import { useLocation } from "react-router-dom";

export default function PlaceholderPage() {
  const { pathname } = useLocation();
  const name = pathname.replace("/", "").replace(/\//g, " › ") || "page";

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 capitalize">{name}</h1>
      <div className="mt-6 bg-white rounded-xl border border-dashed border-gray-200 py-16 text-center">
        <p className="text-sm font-medium text-gray-500">Coming in Phase 1</p>
        <p className="text-xs text-gray-400 mt-1">
          This section is planned — check docs/ROADMAP.md for progress.
        </p>
      </div>
    </div>
  );
}

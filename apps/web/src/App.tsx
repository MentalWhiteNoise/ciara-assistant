import { Routes, Route } from "react-router-dom";

// Placeholder pages — we'll build these out in Phase 1
function DashboardPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
      <p className="mt-2 text-gray-500">Ciara Assistant is running.</p>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-gray-900">404 — Not Found</h1>
    </div>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  );
}

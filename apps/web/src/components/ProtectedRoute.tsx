// ProtectedRoute — wraps any route that requires authentication.
//
// Three states:
//   loading        → show a blank/spinner screen (avoids flash of login page)
//   authenticated  → render children (the actual page)
//   unauthenticated → redirect to /login
//
// Usage in App.tsx:
//   <Route element={<ProtectedRoute />}>
//     <Route path="/" element={<DashboardPage />} />
//   </Route>

import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore, selectIsAuthenticated, selectIsLoading } from "@/stores/auth.store";

export default function ProtectedRoute() {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const isLoading = useAuthStore(selectIsLoading);

  if (isLoading) {
    // Don't flash the login page while we're checking the refresh token.
    // A blank screen for ~200ms is better UX than a redirect and back.
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Authenticated — render the child route
  return <Outlet />;
}

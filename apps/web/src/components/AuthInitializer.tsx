// AuthInitializer — runs once on app mount and attempts to restore a session.
//
// The access token (JWT) is stored in memory only — it's lost on page refresh.
// But the refresh token lives in an httpOnly cookie that persists.
//
// On every page load this component:
//   1. Calls POST /auth/refresh (browser automatically sends the cookie)
//   2. If it gets back a new access token → stores it (user is silently logged in)
//   3. If it fails → marks auth state as unauthenticated → user sees login page
//
// This is what makes "stay logged in" work transparently.

import { useEffect } from "react";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";

interface Props {
  children: React.ReactNode;
}

export default function AuthInitializer({ children }: Props) {
  const { setAuth, clearAuth } = useAuthStore();

  useEffect(() => {
    // This runs once when the app first loads
    authApi.refresh().then((data) => {
      if (data) {
        setAuth(data.user, data.accessToken);
      } else {
        clearAuth(); // no valid session → unauthenticated
      }
    });
    // Empty deps array → only runs once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}

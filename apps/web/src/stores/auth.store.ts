// Zustand auth store — global authentication state.
//
// Zustand stores are created with `create()`. The result is a hook
// (`useAuthStore`) that any component can call to read state or trigger actions.
//
// Example usage in a component:
//   const { user, isAuthenticated, clearAuth } = useAuthStore();

import { create } from "zustand";

interface AuthUser {
  id: string;
  displayName: string;
}

interface AuthState {
  // null = not authenticated or not yet known
  user: AuthUser | null;
  accessToken: string | null;

  // Three-state loading:
  //   'loading' = we haven't checked yet (page just loaded, trying refresh)
  //   'authenticated' = logged in
  //   'unauthenticated' = not logged in
  status: "loading" | "authenticated" | "unauthenticated";

  // Actions — functions that update the state
  setAuth: (user: AuthUser, accessToken: string) => void;
  clearAuth: () => void;
  setLoading: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  status: "loading", // start in loading state; App.tsx will resolve it

  setAuth: (user, accessToken) =>
    set({ user, accessToken, status: "authenticated" }),

  clearAuth: () =>
    set({ user: null, accessToken: null, status: "unauthenticated" }),

  setLoading: () =>
    set({ status: "loading" }),
}));

// Convenience selectors — avoids boilerplate in components
export const selectIsAuthenticated = (s: AuthState) =>
  s.status === "authenticated";
export const selectIsLoading = (s: AuthState) => s.status === "loading";

// Central API client.
//
// All API calls go through apiFetch() — it handles:
//   1. Attaching the Authorization: Bearer <token> header
//   2. Automatic token refresh on 401 (silent re-login using the httpOnly cookie)
//   3. Clearing auth state if refresh fails (forces user back to login)
//
// Usage:
//   const data = await apiFetch<Transaction[]>("/api/transactions");

import { useAuthStore } from "@/stores/auth.store";

// The backend origin — empty string means "same host" (works with Vite proxy in dev
// and when serving the frontend from the API in production)
const API_BASE = "";

// Deduplicate concurrent refresh attempts.
// If two requests fail with 401 simultaneously, only one refresh call is made.
let inflightRefresh: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (inflightRefresh) return inflightRefresh;

  inflightRefresh = fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    credentials: "include", // sends the httpOnly refresh token cookie
  })
    .then(async (r) => {
      if (!r.ok) return null;
      const data = await r.json();
      // Store the new token and user info
      useAuthStore.getState().setAuth(data.user, data.accessToken);
      return data.accessToken as string;
    })
    .catch(() => null)
    .finally(() => {
      inflightRefresh = null;
    });

  return inflightRefresh;
}

// Core fetch wrapper
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = useAuthStore.getState().accessToken;

  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  // Token expired — try to refresh silently
  if (response.status === 401) {
    const newToken = await refreshAccessToken();

    if (newToken) {
      // Retry the original request with the new token
      headers.set("Authorization", `Bearer ${newToken}`);
      const retried = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        credentials: "include",
      });
      if (!retried.ok) {
        await throwApiError(retried);
      }
      return retried.json() as Promise<T>;
    }

    // Refresh failed — clear auth state, caller will be redirected to login
    useAuthStore.getState().clearAuth();
    throw new ApiError(401, "Session expired. Please log in again.");
  }

  if (!response.ok) {
    await throwApiError(response);
  }

  // 204 No Content — return empty object
  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

// Typed error class so callers can catch API errors specifically
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function throwApiError(response: Response): Promise<never> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const message =
    (body as { error?: string } | null)?.error ??
    `Request failed: ${response.status} ${response.statusText}`;
  throw new ApiError(response.status, message, body);
}

// ── Auth-specific API calls ───────────────────────────────────────────────────

export const authApi = {
  status: () =>
    apiFetch<{ configured: boolean }>("/auth/status"),

  setup: (password: string, displayName?: string) =>
    apiFetch<{ ok: boolean }>("/auth/setup", {
      method: "POST",
      body: JSON.stringify({ password, displayName }),
    }),

  login: (password: string) =>
    apiFetch<{ accessToken: string; user: { id: string; displayName: string } }>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ password }),
      }
    ),

  logout: () =>
    apiFetch<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  // Called on page load to restore the session from the httpOnly cookie
  refresh: () =>
    fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    }).then(async (r) => {
      if (!r.ok) return null;
      const data = await r.json();
      return data as { accessToken: string; user: { id: string; displayName: string } };
    }),
};

// LoginPage — shown when the app is configured but no active session exists.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";

export default function LoginPage() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () => authApi.login(password),
    onSuccess: (data) => {
      setAuth(data.user, data.accessToken);
      navigate("/", { replace: true });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    login.mutate();
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-2xl mb-4">
            <span className="text-white text-2xl font-bold">C</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Ciara Assistant</h1>
          <p className="mt-1 text-gray-500 text-sm">Enter your master password</p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your master password"
                required
                autoFocus
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                           placeholder:text-gray-400"
              />
            </div>

            {/* Error */}
            {login.isError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {(login.error as Error)?.message ?? "Login failed"}
              </div>
            )}

            <button
              type="submit"
              disabled={login.isPending || !password}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400
                         text-white text-sm font-medium rounded-lg transition-colors
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              {login.isPending ? "Unlocking…" : "Unlock"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Local-only. Your data never leaves this machine.
        </p>
      </div>
    </div>
  );
}

// SetupPage — shown only on first run, before a master password is set.
// After setup, the user is automatically logged in.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";

export default function SetupPage() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [validationError, setValidationError] = useState("");

  // useMutation handles the async setup + login sequence.
  // `isPending` is true while the request is in flight — used to disable the button.
  const setup = useMutation({
    mutationFn: async () => {
      // Client-side validation before hitting the API
      if (password.length < 8) {
        throw new Error("Password must be at least 8 characters");
      }
      if (password !== confirm) {
        throw new Error("Passwords do not match");
      }
      await authApi.setup(password, displayName || undefined);
      // Immediately log in after setup
      return authApi.login(password);
    },
    onSuccess: (data) => {
      setAuth(data.user, data.accessToken);
      // Auth state change triggers App.tsx routing to redirect to dashboard
    },
    onError: (err: Error) => {
      setValidationError(err.message);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError("");
    setup.mutate();
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-2xl mb-4">
            <span className="text-white text-2xl font-bold">C</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome to Ciara</h1>
          <p className="mt-2 text-gray-500 text-sm">
            Set a master password to secure your data.
            <br />
            This is the only password you'll need.
          </p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Your name (optional)
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Author Name"
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                           placeholder:text-gray-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Master password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                autoFocus
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                           placeholder:text-gray-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Confirm password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Same password again"
                required
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                           placeholder:text-gray-400"
              />
            </div>

            {/* Error message */}
            {(validationError || setup.isError) && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {validationError || (setup.error as Error)?.message}
              </div>
            )}

            <button
              type="submit"
              disabled={setup.isPending}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400
                         text-white text-sm font-medium rounded-lg transition-colors
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              {setup.isPending ? "Setting up…" : "Create password & continue"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Your data is stored locally on this machine. Nothing is sent to the cloud.
        </p>
      </div>
    </div>
  );
}

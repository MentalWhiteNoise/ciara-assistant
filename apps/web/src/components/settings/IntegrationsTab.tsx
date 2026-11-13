// IntegrationsTab — connect external accounts by saving API credentials to
// the server's encrypted vault.
//
// Credentials are write-only from the browser's point of view: we send them
// to the server, but the server only ever replies with "connected / not
// connected". To change a key, you paste a new one.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Link } from "react-router-dom";

interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  optional?: boolean;
  options?: { value: string; label: string }[];
  default?: string;
}

interface Integration {
  id: string;
  displayName: string;
  description: string;
  authType: "api_key" | "import_only";
  fields: CredentialField[];
  help?: string;
  importPath?: string;
  connected: boolean | null;
  connectedAt: string | null;
  /** Saved dropdown values, e.g. { environment: "sandbox" } */
  settings: Record<string, string>;
}

interface TestResult {
  ok: boolean;
  message: string;
  details?: { environment?: string; grantedScopes?: string[] };
}

interface IntegrationsResponse {
  vaultUnlocked: boolean;
  integrations: Integration[];
}

const inputClass =
  "w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-400";

// ── Unlock prompt (shown after a server restart) ────────────────────────────────

function UnlockPanel({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/vault/unlock", { method: "POST", body: JSON.stringify({ password }) }),
    onSuccess: () => {
      setPassword("");
      onUnlocked();
    },
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}
      className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3"
    >
      <div>
        <p className="text-sm font-medium text-amber-900">Vault is locked</p>
        <p className="text-sm text-amber-800 mt-0.5">
          The server restarted since you last logged in. Enter your master password to
          unlock saved credentials so integrations can sync.
        </p>
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
          placeholder="Master password"
          autoComplete="current-password"
        />
        <button
          type="submit"
          disabled={!password || mutation.isPending}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded-lg whitespace-nowrap"
        >
          {mutation.isPending ? "Unlocking…" : "Unlock"}
        </button>
      </div>
      {mutation.error && <p className="text-sm text-red-600">{(mutation.error as Error).message}</p>}
    </form>
  );
}

// ── One API-key integration card ────────────────────────────────────────────────

function ApiKeyCard({ integration, locked }: { integration: Integration; locked: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["integrations"] });

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/api/integrations/${integration.id}`, {
        method: "PUT",
        body: JSON.stringify({ credentials: values }),
      }),
    onSuccess: () => {
      setValues({}); // drop secrets from browser memory as soon as they're saved
      setEditing(false);
      invalidate();
    },
  });

  const test = useMutation({
    mutationFn: () =>
      apiFetch<TestResult>(`/api/integrations/${integration.id}/test`, { method: "POST", body: "{}" }),
  });

  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/integrations/${integration.id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const missingRequired = integration.fields.some(
    (f) => !f.optional && !f.default && !values[f.key]?.trim()
  );
  const environment = integration.settings?.environment;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-900">{integration.displayName}</p>
          <p className="text-xs text-gray-500 mt-0.5">{integration.description}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {environment && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                environment === "live" ? "bg-indigo-50 text-indigo-700" : "bg-amber-50 text-amber-700"
              }`}
            >
              {environment === "live" ? "Live" : "Sandbox"}
            </span>
          )}
          <StatusBadge connected={integration.connected} />
        </div>
      </div>

      {integration.connectedAt && (
        <p className="text-xs text-gray-400 mt-2">
          Saved {new Date(integration.connectedAt).toLocaleDateString()}
        </p>
      )}

      {!editing && !locked && (
        <div className="flex gap-3 mt-3">
          <button
            onClick={() => setEditing(true)}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            {integration.connected ? "Replace credentials" : "Connect"}
          </button>
          {integration.connected && integration.id === "paypal" && (
            <button
              onClick={() => test.mutate()}
              disabled={test.isPending}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-700 disabled:text-indigo-300"
            >
              {test.isPending ? "Testing…" : "Test connection"}
            </button>
          )}
          {integration.connected && (
            <button
              onClick={() => {
                if (confirm(`Remove saved ${integration.displayName} credentials?`)) remove.mutate();
              }}
              className="text-sm text-gray-500 hover:text-red-600"
            >
              Disconnect
            </button>
          )}
        </div>
      )}

      {!editing && test.data && <TestResultPanel result={test.data} />}
      {!editing && !locked && integration.connected && integration.id === "paypal" && <PayPalSyncPanel />}
      {!editing && test.error && (
        <p className="text-sm text-red-600 mt-3">{(test.error as Error).message}</p>
      )}

      {editing && (
        <form
          onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
          className="mt-4 space-y-3"
        >
          {integration.fields.map((field) => (
            <div key={field.key}>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {field.label}
                {field.optional && <span className="text-gray-400 font-normal"> (optional)</span>}
              </label>
              {field.options ? (
                <select
                  value={values[field.key] ?? integration.settings?.[field.key] ?? field.default ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  className={inputClass}
                >
                  {field.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.secret ? "password" : "text"}
                  value={values[field.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  className={inputClass}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </div>
          ))}
          {integration.help && <p className="text-xs text-gray-500">{integration.help}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={missingRequired || save.isPending}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded-lg"
            >
              {save.isPending ? "Saving…" : "Save to vault"}
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setValues({}); }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>
          {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        </form>
      )}
    </div>
  );
}

// Shows the test outcome plus the exact features PayPal granted the app, so a
// Live app's forced-on payment features are visible rather than hidden.
function TestResultPanel({ result }: { result: TestResult }) {
  const scopes = result.details?.grantedScopes ?? [];
  return (
    <div
      className={`mt-3 rounded-lg p-3 text-sm ${
        result.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
      }`}
    >
      <p>{result.message}</p>
      {scopes.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs">
            Permissions PayPal granted this app ({scopes.length})
          </summary>
          <p className="text-xs mt-1 opacity-80">
            Ciara only ever uses Transaction Search. Other permissions below can't be used by
            Ciara — its PayPal code refuses every request except reading reports.
          </p>
          <ul className="mt-1 text-xs font-mono break-all space-y-0.5">
            {scopes.map((s) => (
              <li key={s}>{s.replace("https://uri.paypal.com/services/", "")}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ── PayPal history download ─────────────────────────────────────────────────────

interface SyncJob {
  id: string;
  status: "pending" | "running" | "success" | "failed";
  startedAt: string | null;
  completedAt: string | null;
  recordsImported: number;
  recordsSkipped: number;
  errorMessage: string | null;
  config: { mode: string; start: string; end: string; completedThrough?: string; recordsUpdated?: number } | null;
}

function PayPalSyncPanel() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["sync", "paypal"],
    queryFn: () => apiFetch<{ jobs: SyncJob[]; rawRecordCount: number }>("/api/sync/paypal"),
    // Poll every 2s while a job is running so progress updates live.
    refetchInterval: (q) => (q.state.data?.jobs[0]?.status === "running" ? 2000 : false),
  });

  const start = useMutation({
    mutationFn: (mode: "full" | "incremental") =>
      apiFetch("/api/sync/paypal", { method: "POST", body: JSON.stringify({ mode }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sync", "paypal"] }),
  });

  const latest = data?.jobs[0];
  const running = latest?.status === "running";
  const hasSucceeded = data?.jobs.some((j) => j.status === "success");
  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : "");

  return (
    <div className="mt-4 border-t border-gray-100 pt-3 space-y-2">
      <p className="text-xs text-gray-500">
        Downloaded PayPal records: <span className="font-medium text-gray-700">{data?.rawRecordCount ?? 0}</span>
        {" "}(raw history only — nothing is added to Transactions yet)
      </p>

      {latest && (
        <p className={`text-xs ${latest.status === "failed" ? "text-red-600" : "text-gray-500"}`}>
          {running && <>Downloading… through {fmt(latest.config?.completedThrough ?? latest.config?.start)} of {fmt(latest.config?.end)} · {latest.recordsImported} new</>}
          {latest.status === "success" && <>Last sync {fmt(latest.completedAt ?? undefined)}: {latest.recordsImported} new, {latest.config?.recordsUpdated ?? 0} updated, {latest.recordsSkipped} unchanged</>}
          {latest.status === "failed" && <>Last sync failed: {latest.errorMessage}{latest.config?.completedThrough && <> (got through {fmt(latest.config.completedThrough)})</>}</>}
        </p>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => start.mutate(hasSucceeded ? "incremental" : "full")}
          disabled={running || start.isPending}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-700 disabled:text-indigo-300"
        >
          {hasSucceeded ? "Sync new activity" : "Download full history (3 years)"}
        </button>
        {hasSucceeded && (
          <button
            onClick={() => start.mutate("full")}
            disabled={running || start.isPending}
            className="text-sm text-gray-500 hover:text-gray-800 disabled:text-gray-300"
          >
            Re-download everything
          </button>
        )}
      </div>
      {start.error && <p className="text-xs text-red-600">{(start.error as Error).message}</p>}
    </div>
  );
}

function StatusBadge({ connected }: { connected: boolean | null }) {
  if (connected === null) {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Locked</span>;
  }
  return connected ? (
    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">Connected</span>
  ) : (
    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Not connected</span>
  );
}

// ── Tab ─────────────────────────────────────────────────────────────────────────

export function IntegrationsTab() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["integrations"],
    queryFn: () => apiFetch<IntegrationsResponse>("/api/integrations"),
  });

  const lock = useMutation({
    mutationFn: () => apiFetch("/api/vault/lock", { method: "POST", body: "{}" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integrations"] }),
  });

  if (isLoading || !data) return <p className="text-sm text-gray-400">Loading…</p>;

  const locked = !data.vaultUnlocked;
  const apiKeyIntegrations = data.integrations.filter((i) => i.authType === "api_key");
  const importOnly = data.integrations.filter((i) => i.authType === "import_only");

  return (
    <div className="space-y-6">
      {locked ? (
        <UnlockPanel onUnlocked={() => queryClient.invalidateQueries({ queryKey: ["integrations"] })} />
      ) : (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Credentials are encrypted on this machine and never shown again after saving.</span>
          <button
            onClick={() => lock.mutate()}
            className="text-gray-500 hover:text-gray-800 whitespace-nowrap ml-4"
          >
            Lock vault
          </button>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">API connections</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {apiKeyIntegrations.map((i) => (
            <ApiKeyCard key={i.id} integration={i} locked={locked} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Import-based</h2>
        <p className="text-xs text-gray-500">
          These services don't offer an API for your account. Their data will come in through
          file and email imports instead. No credentials are stored for them.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {importOnly.map((i) => (
            <div key={i.id} className="rounded-lg border border-dashed border-gray-200 p-4">
              <p className="text-sm font-medium text-gray-700">{i.displayName}</p>
              <p className="text-xs text-gray-500 mt-0.5">{i.description}</p>
              {i.importPath && (
                <Link to={i.importPath} className="inline-block mt-2 text-xs font-medium text-indigo-600 hover:underline">
                  Import reports →
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

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
  details?: {
    environment?: string;
    grantedScopes?: string[];
    /** Squarespace: API name → "ok" | "no permission" | "error: …" */
    permissions?: Record<string, string>;
  };
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

// Integrations whose "Test connection" is implemented on the server.
const TESTABLE = new Set(["gmail", "paypal", "squarespace"]);

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
          {integration.connected && TESTABLE.has(integration.id) && (
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
      {!editing && !locked && integration.connected && integration.id === "squarespace" && <SquarespaceSyncPanel />}
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
      {result.details?.permissions && (
        <ul className="mt-2 text-xs space-y-0.5">
          {Object.entries(result.details.permissions).map(([api, status]) => (
            <li key={api}>
              {status === "ok" ? "✓" : "✗"} {api}
              {status !== "ok" && <span className="opacity-80"> — {status}</span>}
            </li>
          ))}
        </ul>
      )}
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
      {!running && (data?.rawRecordCount ?? 0) > 0 && <PayPalImportPanel />}
    </div>
  );
}

// ── Squarespace download ──────────────────────────────────────────────────────

type SquarespaceJob = Omit<SyncJob, "config"> & {
  config: {
    mode: string;
    start?: string;
    end: string;
    current?: string;
    completedKinds?: string[];
    recordsUpdated?: number;
  } | null;
};

const SQ_KIND_LABELS: Record<string, string> = { order: "orders", transaction: "transactions", product: "products" };

function SquarespaceSyncPanel() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["sync", "squarespace"],
    queryFn: () =>
      apiFetch<{ jobs: SquarespaceJob[]; rawRecordCount: number; rawByKind?: Record<string, number> }>(
        "/api/sync/squarespace"
      ),
    refetchInterval: (q) => (q.state.data?.jobs[0]?.status === "running" ? 2000 : false),
  });

  const start = useMutation({
    mutationFn: (mode: "full" | "incremental") =>
      apiFetch("/api/sync/squarespace", { method: "POST", body: JSON.stringify({ mode }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sync", "squarespace"] }),
  });

  const latest = data?.jobs[0];
  const running = latest?.status === "running";
  const hasSucceeded = data?.jobs.some((j) => j.status === "success");
  const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : "");
  const byKind = data?.rawByKind ?? {};

  return (
    <div className="mt-4 border-t border-gray-100 pt-3 space-y-2">
      <p className="text-xs text-gray-500">
        Downloaded:{" "}
        {Object.keys(SQ_KIND_LABELS).map((k, i) => (
          <span key={k}>
            {i > 0 && " · "}
            <span className="font-medium text-gray-700">{byKind[k] ?? 0}</span> {SQ_KIND_LABELS[k]}
          </span>
        ))}{" "}
        (raw history only — nothing is added to Transactions yet)
      </p>

      {latest && (
        <p className={`text-xs ${latest.status === "failed" ? "text-red-600" : "text-gray-500"}`}>
          {running && <>Downloading {SQ_KIND_LABELS[latest.config?.current ?? ""] ?? "…"} · {latest.recordsImported} new so far</>}
          {latest.status === "success" && <>Last sync {fmt(latest.completedAt)}: {latest.recordsImported} new, {latest.config?.recordsUpdated ?? 0} updated, {latest.recordsSkipped} unchanged</>}
          {latest.status === "failed" && <>Last sync failed: {latest.errorMessage}</>}
        </p>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => start.mutate(hasSucceeded ? "incremental" : "full")}
          disabled={running || start.isPending}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-700 disabled:text-indigo-300"
        >
          {hasSucceeded ? "Sync new activity" : "Download full history"}
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
      {!running && (byKind.order ?? 0) > 0 && <SquarespaceImportPanel />}
    </div>
  );
}

interface YearBreakdown {
  orders: number; gross: number; products: number; shipping: number;
  tax: number; refunds: number; fees: number; net: number;
}

interface SquarespaceImportSummary {
  ordersToProcess: number;
  ordersNew: number;
  ordersUpdated: number;
  created: { sales: number; fees: number; platformFees: number; refunds: number };
  alreadyImported: number;
  paypalLinks: number;
  deferred: number;
  skipped: Record<string, number>;
  taxFlagged: { orders: number; tax: number };
  byYear: Record<string, YearBreakdown>;
  byProcessor: Record<string, number>;
}

const money = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });

function SquarespaceImportPanel() {
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ["squarespace-import-preview"],
    queryFn: () => apiFetch<SquarespaceImportSummary>("/api/sync/squarespace/import"),
  });
  const run = useMutation({
    mutationFn: () => apiFetch<SquarespaceImportSummary>("/api/sync/squarespace/import", { method: "POST", body: "{}" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["squarespace-import-preview"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const s = preview.data;
  if (!s) return null;
  const years = Object.keys(s.byYear).sort();
  const cols: [keyof YearBreakdown, string][] = [
    ["gross", "Gross"], ["products", "Products"], ["shipping", "Shipping"], ["tax", "Tax"],
    ["refunds", "Refunds"], ["fees", "Fees"], ["net", "Net"],
  ];

  return (
    <div className="mt-3 rounded-lg bg-gray-50 p-3 space-y-2 text-xs text-gray-600">
      <p className="font-medium text-gray-800">Website sales — gross vs net</p>
      <div className="overflow-x-auto">
        <table className="w-full text-right tabular-nums">
          <thead>
            <tr className="text-gray-500">
              <th className="text-left font-normal">Year</th>
              <th className="font-normal">Orders</th>
              {cols.map(([, label]) => <th key={label} className="font-normal pl-2">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y}>
                <td className="text-left">{y}</td>
                <td>{s.byYear[y].orders}</td>
                {cols.map(([k]) => (
                  <td key={k} className={`pl-2 ${k === "net" ? "font-medium text-gray-800" : ""}`}>{money(s.byYear[y][k])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-gray-500">
        Gross = what customers paid (products + shipping + tax). Net = gross − refunds − processing fees.
        Paid by: {Object.entries(s.byProcessor).map(([p, n]) => `${p === "SQSP_PAYMENTS" ? "Squarespace Payments" : p === "PAYPAL" ? "PayPal" : p} ${n}`).join(", ")}.
      </p>

      {s.ordersToProcess === 0 ? (
        <p>Everything downloaded has been imported.</p>
      ) : (
        <>
          <p>
            Importing would add <b>{s.ordersNew}</b> orders{s.ordersUpdated > 0 && <> (and refresh {s.ordersUpdated})</>},{" "}
            <b>{s.created.sales}</b> sales, <b>{s.created.fees}</b> processing fees and <b>{s.created.refunds}</b> refunds,
            and link <b>{s.paypalLinks}</b> existing PayPal sales to their website orders (moving them to the website channel — no duplicates).
            {s.created.platformFees > 0 && <> Also adds <b>{s.created.platformFees}</b> Squarespace 3% transaction fees on PayPal-paid orders that PayPal didn't deduct.</>}
          </p>
          {s.taxFlagged.orders > 0 && (
            <p className="text-amber-700">
              {s.taxFlagged.orders} orders collected {money(s.taxFlagged.tax)} sales tax. It stays inside the sale for now and those
              sales are flagged in their notes until you confirm whether it was remitted.
            </p>
          )}
          {s.deferred > 0 && <p className="text-amber-700">{s.deferred} PayPal-paid orders will wait until their PayPal sale is imported.</p>}
          <button
            onClick={() => run.mutate()}
            disabled={run.isPending}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-xs font-medium rounded-lg"
          >
            {run.isPending ? "Importing…" : "Import into Ciara"}
          </button>
        </>
      )}
      {run.data && <p className="text-emerald-700">Imported. {run.data.created.sales} sales, {run.data.paypalLinks} PayPal sales linked.</p>}
      {run.error && <p className="text-red-600">{(run.error as Error).message}</p>}
    </div>
  );
}

// ── Turn downloaded records into transactions ─────────────────────────────────

interface ImportSummary {
  recordsProcessed: number;
  deferred: number;
  skipped: Record<string, number>;
  alreadyImported: number;
  created: Record<string, Record<string, number>>;
  ruleMatches: number;
  totalsUsd: { sales: number; refunds: number; fees: number; otherExpenses: number };
  nonUsdCount: number;
}

function sumStatus(s: ImportSummary, status: string) {
  return Object.values(s.created).reduce((n, byStatus) => n + (byStatus[status] ?? 0), 0);
}

function PayPalImportPanel() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["paypal-import-preview"],
    queryFn: () => apiFetch<{ unprocessed: number; preview: ImportSummary }>("/api/sync/paypal/import"),
  });
  const run = useMutation({
    mutationFn: () => apiFetch<ImportSummary>("/api/sync/paypal/import", { method: "POST", body: "{}" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["paypal-import-preview"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["review-groups"] });
    },
  });

  const money = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });

  if (run.data) {
    const review = sumStatus(run.data, "needs_review");
    return (
      <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
        Imported. {sumStatus(run.data, "confirmed")} transactions added
        {review > 0 && (
          <>, {review} waiting for review — <Link to="/review" className="font-medium underline">review now</Link></>
        )}
        .
      </div>
    );
  }
  if (!data || data.unprocessed === 0) return null;

  const p = data.preview;
  const c = (type: string) => Object.values(p.created[type] ?? {}).reduce((a, b) => a + b, 0);
  const review = sumStatus(p, "needs_review");
  const nothingToCreate = Object.keys(p.created).length === 0;

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 text-sm space-y-2">
      <p className="font-medium text-gray-900">
        {data.unprocessed} downloaded record{data.unprocessed === 1 ? "" : "s"} not yet in Transactions
      </p>
      {nothingToCreate ? (
        <p className="text-xs text-gray-600">Nothing new to add (holds, conversions or pending payments only).</p>
      ) : (
        <ul className="text-xs text-gray-700 space-y-0.5">
          <li>{c("sale")} sales · {money(p.totalsUsd.sales)}</li>
          <li>{c("expense")} expenses · {money(p.totalsUsd.fees)} PayPal/platform fees + {money(p.totalsUsd.otherExpenses)} other</li>
          {c("refund") > 0 && <li>{c("refund")} refunds · {money(p.totalsUsd.refunds)}</li>}
          {c("transfer") > 0 && <li>{c("transfer")} bank transfers (not counted as income or expense)</li>}
          {review > 0 && (
            <li className="text-amber-700">
              {review} will need review (possibly personal) — left out of reports until you decide
            </li>
          )}
          {p.ruleMatches > 0 && <li>{p.ruleMatches} filed automatically by your payee rules</li>}
          {p.deferred > 0 && <li>{p.deferred} pending in PayPal — will import once they complete</li>}
          {p.nonUsdCount > 0 && <li className="text-amber-700">{p.nonUsdCount} in a foreign currency with no USD conversion</li>}
        </ul>
      )}
      {!nothingToCreate && (
        <button
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded-lg"
        >
          {run.isPending ? "Importing…" : "Import into Transactions"}
        </button>
      )}
      {run.error && <p className="text-xs text-red-600">{(run.error as Error).message}</p>}
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

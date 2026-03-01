// SettingsPage — configure the app's reference data and account.
//
// Tabs:
//   Account      — display name
//   Event Types  — add / edit / delete event types (name, color, category)
//   Categories   — add / edit / delete income & expense categories
//   Channels     — add / edit / delete sales channels

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

interface EventType {
  id: string;
  name: string;
  color?: string | null;
  category?: string | null;
}

interface Category {
  id: string;
  name: string;
  type: "income" | "expense" | "asset";
  taxLine?: string | null;
  color?: string | null;
}

interface Channel {
  id: string;
  name: string;
  type: "online" | "in-person" | "wholesale" | "distributor";
  isActive: boolean;
}

// ── Shared UI components ───────────────────────────────────────────────────────

function SlideOver({
  open, title, onClose, children,
}: {
  open: boolean; title: string; onClose: () => void; children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-md bg-white shadow-xl flex flex-col h-full z-50">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

const inputClass = "w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-400";
const selectClass = "w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500";

// ── Account tab ────────────────────────────────────────────────────────────────

function AccountTab() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<{ displayName: string }>("/api/settings"),
  });

  const [name, setName] = useState<string>(() => data?.displayName ?? "");
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: (displayName: string) =>
      apiFetch("/api/settings", { method: "PUT", body: JSON.stringify({ displayName }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  // Sync field if query loads after initial render
  const currentName = data?.displayName ?? "";
  if (name === "" && currentName) setName(currentName);

  return (
    <div className="max-w-sm space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Display name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setSaved(false); }}
          className={inputClass}
          placeholder="Your name"
        />
      </div>
      <button
        onClick={() => mutation.mutate(name)}
        disabled={mutation.isPending || !name.trim()}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded-lg transition-colors"
      >
        {mutation.isPending ? "Saving…" : saved ? "Saved!" : "Save"}
      </button>
      {mutation.error && (
        <p className="text-sm text-red-600">{(mutation.error as Error).message}</p>
      )}
    </div>
  );
}

// ── Event Types tab ────────────────────────────────────────────────────────────

const ET_CATEGORIES = [
  "writing", "editing", "marketing", "event", "admin", "commission", "other",
] as const;

const PRESET_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f59e0b", "#10b981", "#14b8a6", "#3b82f6",
  "#64748b", "#ef4444",
];

interface EtForm { name: string; color: string; category: string; }
const EMPTY_ET: EtForm = { name: "", color: "#6366f1", category: "other" };

function EventTypesTab() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<EventType | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [form, setForm] = useState<EtForm>(EMPTY_ET);

  const { data: types = [] } = useQuery({
    queryKey: ["event-types"],
    queryFn: () => apiFetch<EventType[]>("/api/event-types"),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["event-types"] });

  const createMutation = useMutation({
    mutationFn: (data: EtForm) =>
      apiFetch("/api/event-types", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { invalidate(); setAddingNew(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<EtForm> }) =>
      apiFetch(`/api/event-types/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => { invalidate(); setEditing(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/event-types/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  function openNew() { setForm(EMPTY_ET); setEditing(null); setAddingNew(true); }
  function openEdit(t: EventType) {
    setForm({ name: t.name, color: t.color ?? "#6366f1", category: t.category ?? "other" });
    setEditing(t);
    setAddingNew(false);
  }

  const panelOpen = addingNew || !!editing;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{types.length} event types</p>
        <button onClick={openNew} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
          + Add type
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {types.length === 0 && (
          <p className="px-4 py-8 text-sm text-gray-400 text-center">No event types yet.</p>
        )}
        {types.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-3">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: t.color ?? "#6366f1" }} />
            <span className="flex-1 text-sm font-medium text-gray-900">{t.name}</span>
            {t.category && (
              <span className="text-xs text-gray-400 capitalize">{t.category}</span>
            )}
            <button onClick={() => openEdit(t)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Edit</button>
            <button
              onClick={() => { if (confirm(`Delete "${t.name}"?`)) deleteMutation.mutate(t.id); }}
              className="text-xs text-gray-400 hover:text-red-600"
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <SlideOver
        open={panelOpen}
        title={editing ? "Edit event type" : "New event type"}
        onClose={() => { setEditing(null); setAddingNew(false); }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (editing) updateMutation.mutate({ id: editing.id, data: form });
            else createMutation.mutate(form);
          }}
          className="p-6 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Name <span className="text-red-500">*</span></label>
            <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} required autoFocus className={inputClass} placeholder="e.g. Book Signing" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Category</label>
            <select value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))} className={selectClass}>
              {ET_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Color</label>
            <div className="flex items-center gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, color: c }))}
                  className={`w-7 h-7 rounded-full transition-transform ${form.color === c ? "ring-2 ring-offset-2 ring-indigo-500 scale-110" : "hover:scale-105"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm(f => ({ ...f, color: e.target.value }))}
                className="w-7 h-7 rounded cursor-pointer border border-gray-300"
                title="Custom color"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => { setEditing(null); setAddingNew(false); }} className="flex-1 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={createMutation.isPending || updateMutation.isPending || !form.name} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded-lg">
              {createMutation.isPending || updateMutation.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </SlideOver>
    </>
  );
}

// ── Categories tab ─────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = { income: "Income", expense: "Expense", asset: "Asset" };
const TYPE_COLORS: Record<string, string> = {
  income: "bg-green-100 text-green-700",
  expense: "bg-red-100 text-red-700",
  asset: "bg-blue-100 text-blue-700",
};

interface CatForm { name: string; type: "income" | "expense" | "asset"; taxLine: string; }
const EMPTY_CAT: CatForm = { name: "", type: "expense", taxLine: "" };

function CategoriesTab() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Category | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [form, setForm] = useState<CatForm>(EMPTY_CAT);
  const [filterType, setFilterType] = useState<string>("");

  const { data: cats = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<Category[]>("/api/categories"),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["categories"] });

  const createMutation = useMutation({
    mutationFn: (data: CatForm) =>
      apiFetch("/api/categories", { method: "POST", body: JSON.stringify({ ...data, taxLine: data.taxLine || undefined }) }),
    onSuccess: () => { invalidate(); setAddingNew(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CatForm> }) =>
      apiFetch(`/api/categories/${id}`, { method: "PUT", body: JSON.stringify({ ...data, taxLine: data.taxLine || undefined }) }),
    onSuccess: () => { invalidate(); setEditing(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/categories/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  function openNew() { setForm(EMPTY_CAT); setEditing(null); setAddingNew(true); }
  function openEdit(c: Category) {
    setForm({ name: c.name, type: c.type, taxLine: c.taxLine ?? "" });
    setEditing(c);
    setAddingNew(false);
  }

  const displayed = filterType ? cats.filter((c) => c.type === filterType) : cats;
  const panelOpen = addingNew || !!editing;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1">
          {["", "income", "expense", "asset"].map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${filterType === t ? "bg-indigo-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-indigo-300"}`}
            >
              {t === "" ? "All" : TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <button onClick={openNew} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
          + Add category
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {displayed.length === 0 && (
          <p className="px-4 py-8 text-sm text-gray-400 text-center">No categories.</p>
        )}
        {displayed.map((c) => (
          <div key={c.id} className="flex items-center gap-3 px-4 py-3">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${TYPE_COLORS[c.type]}`}>
              {TYPE_LABELS[c.type]}
            </span>
            <span className="flex-1 text-sm text-gray-900">{c.name}</span>
            {c.taxLine && <span className="text-xs text-gray-400 font-mono">{c.taxLine}</span>}
            <button onClick={() => openEdit(c)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Edit</button>
            <button
              onClick={() => { if (confirm(`Delete "${c.name}"?`)) deleteMutation.mutate(c.id); }}
              className="text-xs text-gray-400 hover:text-red-600"
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <SlideOver
        open={panelOpen}
        title={editing ? "Edit category" : "New category"}
        onClose={() => { setEditing(null); setAddingNew(false); }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (editing) updateMutation.mutate({ id: editing.id, data: form });
            else createMutation.mutate(form);
          }}
          className="p-6 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Name <span className="text-red-500">*</span></label>
            <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} required autoFocus className={inputClass} placeholder="e.g. Office supplies" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Type <span className="text-red-500">*</span></label>
            <select value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value as CatForm["type"] }))} className={selectClass}>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
              <option value="asset">Asset</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">IRS tax line <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="text" value={form.taxLine} onChange={(e) => setForm(f => ({ ...f, taxLine: e.target.value }))} className={inputClass} placeholder="e.g. line_18" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => { setEditing(null); setAddingNew(false); }} className="flex-1 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={createMutation.isPending || updateMutation.isPending || !form.name} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded-lg">
              {createMutation.isPending || updateMutation.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </SlideOver>
    </>
  );
}

// ── Channels tab ───────────────────────────────────────────────────────────────

const CH_TYPES = [
  { value: "online", label: "Online" },
  { value: "in-person", label: "In-person" },
  { value: "wholesale", label: "Wholesale" },
  { value: "distributor", label: "Distributor" },
];

interface ChForm { name: string; type: Channel["type"]; isActive: boolean; }
const EMPTY_CH: ChForm = { name: "", type: "online", isActive: true };

function ChannelsTab() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Channel | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [form, setForm] = useState<ChForm>(EMPTY_CH);

  const { data: chans = [] } = useQuery({
    queryKey: ["channels"],
    queryFn: () => apiFetch<Channel[]>("/api/channels"),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["channels"] });

  const createMutation = useMutation({
    mutationFn: (data: ChForm) =>
      apiFetch("/api/channels", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { invalidate(); setAddingNew(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ChForm> }) =>
      apiFetch(`/api/channels/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => { invalidate(); setEditing(null); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch(`/api/channels/${id}`, { method: "PUT", body: JSON.stringify({ isActive }) }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/channels/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  function openNew() { setForm(EMPTY_CH); setEditing(null); setAddingNew(true); }
  function openEdit(c: Channel) {
    setForm({ name: c.name, type: c.type, isActive: c.isActive });
    setEditing(c);
    setAddingNew(false);
  }

  const panelOpen = addingNew || !!editing;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{chans.length} channels</p>
        <button onClick={openNew} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
          + Add channel
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {chans.length === 0 && (
          <p className="px-4 py-8 text-sm text-gray-400 text-center">No channels yet.</p>
        )}
        {chans.map((c) => (
          <div key={c.id} className="flex items-center gap-3 px-4 py-3">
            <span className="flex-1 text-sm font-medium text-gray-900">{c.name}</span>
            <span className="text-xs text-gray-400 capitalize">{c.type.replace("-", "‑")}</span>
            {/* Active toggle */}
            <button
              onClick={() => toggleMutation.mutate({ id: c.id, isActive: !c.isActive })}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${c.isActive ? "bg-indigo-600" : "bg-gray-200"}`}
              title={c.isActive ? "Active — click to deactivate" : "Inactive — click to activate"}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${c.isActive ? "translate-x-4" : "translate-x-0.5"}`} />
            </button>
            <button onClick={() => openEdit(c)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Edit</button>
            <button
              onClick={() => { if (confirm(`Delete "${c.name}"?`)) deleteMutation.mutate(c.id); }}
              className="text-xs text-gray-400 hover:text-red-600"
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <SlideOver
        open={panelOpen}
        title={editing ? "Edit channel" : "New channel"}
        onClose={() => { setEditing(null); setAddingNew(false); }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (editing) updateMutation.mutate({ id: editing.id, data: form });
            else createMutation.mutate(form);
          }}
          className="p-6 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Name <span className="text-red-500">*</span></label>
            <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} required autoFocus className={inputClass} placeholder="e.g. Amazon KDP" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Type</label>
            <select value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value as Channel["type"] }))} className={selectClass}>
              {CH_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <input type="checkbox" id="chActive" checked={form.isActive} onChange={(e) => setForm(f => ({ ...f, isActive: e.target.checked }))} className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
            <label htmlFor="chActive" className="text-sm text-gray-700 select-none cursor-pointer">Active</label>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => { setEditing(null); setAddingNew(false); }} className="flex-1 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={createMutation.isPending || updateMutation.isPending || !form.name} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded-lg">
              {createMutation.isPending || updateMutation.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </SlideOver>
    </>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

type TabKey = "account" | "event-types" | "categories" | "channels";

const TABS: { key: TabKey; label: string }[] = [
  { key: "account", label: "Account" },
  { key: "event-types", label: "Event Types" },
  { key: "categories", label: "Categories" },
  { key: "channels", label: "Channels" },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<TabKey>("account");

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-400 mt-0.5">Manage your account and reference data</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "account" && <AccountTab />}
      {tab === "event-types" && <EventTypesTab />}
      {tab === "categories" && <CategoriesTab />}
      {tab === "channels" && <ChannelsTab />}
    </div>
  );
}

// TransactionsPage — manual income and expense entry.
// Displays a filterable table of transactions with an add/edit slide-over form.

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { apiFetch } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

type TxType = "sale" | "expense" | "refund" | "transfer";

interface Transaction {
  id: string;
  type: TxType;
  amount: number;
  currency: string;
  description: string;
  categoryId?: string | null;
  channelId?: string | null;
  productId?: string | null;
  payee?: string | null;
  paymentMethod?: string | null;
  notes?: string | null;
  isTaxDeductible: boolean;
  taxCategory?: string | null;
  occurredAt: string;
  source: string;
  createdAt: string;
}

interface Category {
  id: string;
  name: string;
  type: string;
}

interface Channel {
  id: string;
  name: string;
}

interface Product {
  id: string;
  title: string;
  type: string;
}

interface TxFormData {
  type: TxType;
  amount: string; // string in form, parsed to number on submit
  description: string;
  categoryId: string;
  channelId: string;
  productId: string;
  payee: string;
  paymentMethod: string;
  notes: string;
  isTaxDeductible: boolean;
  occurredAt: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TX_TYPES: { value: TxType; label: string }[] = [
  { value: "sale", label: "Sale" },
  { value: "expense", label: "Expense" },
  { value: "refund", label: "Refund" },
  { value: "transfer", label: "Transfer" },
];

const TYPE_COLORS: Record<TxType, string> = {
  sale: "bg-green-100 text-green-700",
  expense: "bg-red-100 text-red-700",
  refund: "bg-amber-100 text-amber-700",
  transfer: "bg-gray-100 text-gray-600",
};

const AMOUNT_COLORS: Record<TxType, string> = {
  sale: "text-green-600",
  expense: "text-red-600",
  refund: "text-amber-600",
  transfer: "text-gray-600",
};

const AMOUNT_PREFIX: Record<TxType, string> = {
  sale: "+",
  expense: "−",
  refund: "−",
  transfer: "",
};

const EMPTY_FORM: TxFormData = {
  type: "expense",
  amount: "",
  description: "",
  categoryId: "",
  channelId: "",
  productId: "",
  payee: "",
  paymentMethod: "",
  notes: "",
  isTaxDeductible: false,
  occurredAt: new Date().toISOString().slice(0, 10), // today
};

// ── Payload type for create/update (optional fields allowed) ──────────────────

interface TxPayload {
  type: TxType;
  amount: number;
  description: string;
  occurredAt: string;
  isTaxDeductible: boolean;
  categoryId?: string;
  channelId?: string;
  productId?: string;
  payee?: string;
  paymentMethod?: string;
  notes?: string;
}

// ── API calls ──────────────────────────────────────────────────────────────────

const txApi = {
  list: (type?: string, from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    return apiFetch<Transaction[]>(`/api/transactions${qs ? `?${qs}` : ""}`);
  },
  create: (data: TxPayload) =>
    apiFetch<Transaction>("/api/transactions", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<TxPayload>) =>
    apiFetch<Transaction>(`/api/transactions/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<void>(`/api/transactions/${id}`, { method: "DELETE" }),
};

const refApi = {
  categories: () => apiFetch<Category[]>("/api/categories"),
  channels: () => apiFetch<Channel[]>("/api/channels"),
  products: () => apiFetch<Product[]>("/api/products"),
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

function formatDate(isoDate: string) {
  return new Date(isoDate + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function SlideOver({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-md bg-white shadow-xl flex flex-col h-full z-50">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-hidden flex flex-col">{children}</div>
      </div>
    </div>
  );
}

// ── Transaction form ───────────────────────────────────────────────────────────

function TxForm({
  initial,
  categories,
  channels,
  products,
  onSave,
  onCancel,
  isPending,
  error,
}: {
  initial: TxFormData;
  categories: Category[];
  channels: Channel[];
  products: Product[];
  onSave: (data: TxFormData) => void;
  onCancel: () => void;
  isPending: boolean;
  error?: string;
}) {
  const [form, setForm] = useState<TxFormData>(initial);

  function set<K extends keyof TxFormData>(field: K, value: TxFormData[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(form);
  }

  // Filter categories to match the transaction type
  const relevantCategories = categories.filter((c) => {
    if (form.type === "sale") return c.type === "income";
    if (form.type === "expense") return c.type === "expense";
    return true;
  });

  const inputClass =
    "w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-400";
  const selectClass =
    "w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Type + Date */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Type <span className="text-red-500">*</span>
            </label>
            <select
              value={form.type}
              onChange={(e) => set("type", e.target.value as TxType)}
              className={selectClass}
            >
              {TX_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={form.occurredAt}
              onChange={(e) => set("occurredAt", e.target.value)}
              required
              className={inputClass}
            />
          </div>
        </div>

        {/* Amount */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Amount (USD) <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
              $
            </span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              placeholder="0.00"
              required
              className={`${inputClass} pl-7`}
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Description <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder={
              form.type === "sale"
                ? "e.g. Book sale — Amazon KDP"
                : "e.g. Printing supplies"
            }
            required
            className={inputClass}
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Category
          </label>
          <select
            value={form.categoryId}
            onChange={(e) => set("categoryId", e.target.value)}
            className={selectClass}
          >
            <option value="">— None —</option>
            {relevantCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Channel */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Channel / Platform
          </label>
          <select
            value={form.channelId}
            onChange={(e) => set("channelId", e.target.value)}
            className={selectClass}
          >
            <option value="">— None —</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Product (only relevant for sales) */}
        {(form.type === "sale" || form.type === "refund") && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Product
            </label>
            <select
              value={form.productId}
              onChange={(e) => set("productId", e.target.value)}
              className={selectClass}
            >
              <option value="">— None —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Payee + Payment method */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Payee / Vendor
            </label>
            <input
              type="text"
              value={form.payee}
              onChange={(e) => set("payee", e.target.value)}
              placeholder="e.g. Office Depot"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Payment method
            </label>
            <input
              type="text"
              value={form.paymentMethod}
              onChange={(e) => set("paymentMethod", e.target.value)}
              placeholder="e.g. PayPal, Credit card"
              className={inputClass}
            />
          </div>
        </div>

        {/* Tax deductible */}
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="taxDeductible"
            checked={form.isTaxDeductible}
            onChange={(e) => set("isTaxDeductible", e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <label
            htmlFor="taxDeductible"
            className="text-sm text-gray-700 select-none cursor-pointer"
          >
            Tax deductible (Schedule C)
          </label>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Notes
          </label>
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={2}
            placeholder="Optional notes"
            className={`${inputClass} resize-none`}
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 p-4 flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 text-sm font-medium
                     rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending || !form.amount || !form.description}
          className="flex-1 py-2 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400
                     text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isPending ? "Saving…" : "Save transaction"}
        </button>
      </div>
    </form>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function TransactionsPage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [openTxId] = useState<string | null>(() => location.state?.openTxId ?? null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [filterType, setFilterType] = useState("");

  // Queries
  const { data: transactions = [], isLoading, error } = useQuery({
    queryKey: ["transactions", filterType],
    queryFn: () => txApi.list(filterType || undefined),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: refApi.categories,
  });

  const { data: channels = [] } = useQuery({
    queryKey: ["channels"],
    queryFn: refApi.channels,
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: refApi.products,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: txApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      setAddingNew(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof txApi.update>[1] }) =>
      txApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: txApi.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["transactions"] }),
  });

  // Lookup maps for display
  const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const channelMap = Object.fromEntries(channels.map((c) => [c.id, c.name]));

  // If navigated from dashboard with a transaction ID, open its edit panel once data loads
  useEffect(() => {
    if (!openTxId || transactions.length === 0) return;
    const tx = transactions.find((t) => t.id === openTxId);
    if (tx) {
      setEditing(tx);
      setAddingNew(false);
    }
  }, [openTxId, transactions]);

  function openEdit(tx: Transaction) {
    setEditing(tx);
    setAddingNew(false);
  }

  function openNew() {
    setEditing(null);
    setAddingNew(true);
  }

  function closePanel() {
    setEditing(null);
    setAddingNew(false);
  }

  const panelOpen = addingNew || editing !== null;

  const formInitial: TxFormData = editing
    ? {
        type: editing.type,
        amount: editing.amount.toString(),
        description: editing.description,
        categoryId: editing.categoryId ?? "",
        channelId: editing.channelId ?? "",
        productId: editing.productId ?? "",
        payee: editing.payee ?? "",
        paymentMethod: editing.paymentMethod ?? "",
        notes: editing.notes ?? "",
        isTaxDeductible: editing.isTaxDeductible,
        occurredAt: editing.occurredAt.slice(0, 10),
      }
    : EMPTY_FORM;

  function handleSave(formData: TxFormData) {
    // Parse amount to number, strip empty optional strings → undefined
    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) return;

    const clean = {
      ...formData,
      amount,
      categoryId: formData.categoryId || undefined,
      channelId: formData.channelId || undefined,
      productId: formData.productId || undefined,
      payee: formData.payee || undefined,
      paymentMethod: formData.paymentMethod || undefined,
      notes: formData.notes || undefined,
    };

    if (editing) {
      updateMutation.mutate({ id: editing.id, data: clean });
    } else {
      createMutation.mutate(clean);
    }
  }

  const mutationError =
    (createMutation.error as Error)?.message ??
    (updateMutation.error as Error)?.message;
  const mutationPending = createMutation.isPending || updateMutation.isPending;

  // Summary totals for current view
  const totalIncome = transactions
    .filter((t) => t.type === "sale")
    .reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = transactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + t.amount, 0);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Transactions</h1>
          <p className="text-sm text-gray-400 mt-0.5">Income and expenses</p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium
                     rounded-lg transition-colors"
        >
          + New transaction
        </button>
      </div>

      {/* Summary row */}
      {transactions.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Income</p>
            <p className="text-xl font-semibold text-green-600 mt-1">
              {formatAmount(totalIncome, "USD")}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Expenses</p>
            <p className="text-xl font-semibold text-red-600 mt-1">
              {formatAmount(totalExpenses, "USD")}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Net</p>
            <p
              className={`text-xl font-semibold mt-1 ${
                totalIncome - totalExpenses >= 0 ? "text-gray-900" : "text-red-600"
              }`}
            >
              {formatAmount(totalIncome - totalExpenses, "USD")}
            </p>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex gap-2 mb-4">
        {["", "sale", "expense", "refund", "transfer"].map((t) => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filterType === t
                ? "bg-indigo-600 text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:border-indigo-300"
            }`}
          >
            {t === "" ? "All" : t.charAt(0).toUpperCase() + t.slice(1) + "s"}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-sm text-red-700">
          Failed to load transactions. {(error as Error).message}
        </div>
      ) : transactions.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <p className="text-gray-400 text-sm mb-3">No transactions yet.</p>
          <button
            onClick={openNew}
            className="text-indigo-600 text-sm font-medium hover:underline"
          >
            Add your first transaction →
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Description</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Type</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Category</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Channel</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr
                  key={tx.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {formatDate(tx.occurredAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{tx.description}</div>
                    {tx.payee && (
                      <div className="text-xs text-gray-400 mt-0.5">{tx.payee}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      label={tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}
                      className={TYPE_COLORS[tx.type]}
                    />
                  </td>
                  <td className={`px-4 py-3 text-right font-medium ${AMOUNT_COLORS[tx.type]}`}>
                    {AMOUNT_PREFIX[tx.type]}{formatAmount(tx.amount, tx.currency)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {categoryMap[tx.categoryId ?? ""] ?? (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {channelMap[tx.channelId ?? ""] ?? (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => openEdit(tx)}
                      className="text-indigo-600 hover:text-indigo-800 text-xs font-medium mr-3"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete "${tx.description}"?`)) {
                          deleteMutation.mutate(tx.id);
                        }
                      }}
                      className="text-gray-400 hover:text-red-600 text-xs"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit slide-over */}
      <SlideOver
        open={panelOpen}
        title={editing ? "Edit transaction" : "New transaction"}
        onClose={closePanel}
      >
        <TxForm
          key={editing?.id ?? "new"}
          initial={formInitial}
          categories={categories}
          channels={channels}
          products={products}
          onSave={handleSave}
          onCancel={closePanel}
          isPending={mutationPending}
          error={mutationError}
        />
      </SlideOver>
    </div>
  );
}

// ProductsPage — CRUD for the product/catalog.
// Displays a table of products with an add/edit slide-over form.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

type ProductType = "book" | "print" | "merch" | "service" | "commission";
type ProductStatus = "active" | "draft" | "archived";

interface Product {
  id: string;
  type: ProductType;
  title: string;
  subtitle?: string | null;
  isbn?: string | null;
  sku?: string | null;
  description?: string | null;
  publishedAt?: string | null;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
}

interface ProductFormData {
  type: ProductType;
  title: string;
  subtitle: string;
  isbn: string;
  sku: string;
  description: string;
  publishedAt: string;
  status: ProductStatus;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PRODUCT_TYPES: { value: ProductType; label: string }[] = [
  { value: "book", label: "Book" },
  { value: "print", label: "Print" },
  { value: "merch", label: "Merch" },
  { value: "service", label: "Service" },
  { value: "commission", label: "Commission" },
];

const TYPE_COLORS: Record<ProductType, string> = {
  book: "bg-indigo-100 text-indigo-700",
  print: "bg-purple-100 text-purple-700",
  merch: "bg-amber-100 text-amber-700",
  service: "bg-blue-100 text-blue-700",
  commission: "bg-pink-100 text-pink-700",
};

const STATUS_COLORS: Record<ProductStatus, string> = {
  active: "bg-green-100 text-green-700",
  draft: "bg-gray-100 text-gray-600",
  archived: "bg-red-100 text-red-600",
};

const EMPTY_FORM: ProductFormData = {
  type: "book",
  title: "",
  subtitle: "",
  isbn: "",
  sku: "",
  description: "",
  publishedAt: "",
  status: "active",
};

// ── API calls ──────────────────────────────────────────────────────────────────

const productsApi = {
  list: () => apiFetch<Product[]>("/api/products"),
  create: (data: ProductFormData) =>
    apiFetch<Product>("/api/products", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<ProductFormData>) =>
    apiFetch<Product>(`/api/products/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  archive: (id: string) =>
    apiFetch<void>(`/api/products/${id}`, { method: "DELETE" }),
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function Badge({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

// ── ProductForm — add/edit slide-over panel ────────────────────────────────────

function ProductForm({
  initial,
  onSave,
  onCancel,
  isPending,
  error,
}: {
  initial: ProductFormData;
  onSave: (data: ProductFormData) => void;
  onCancel: () => void;
  isPending: boolean;
  error?: string;
}) {
  const [form, setForm] = useState<ProductFormData>(initial);

  function set(field: keyof ProductFormData, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(form);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Type <span className="text-red-500">*</span>
          </label>
          <select
            value={form.type}
            onChange={(e) => set("type", e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm bg-white
                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {PRODUCT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="e.g. The Dragon's Eye"
            required
            className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm
                       focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-400"
          />
        </div>

        {/* Subtitle */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Subtitle
          </label>
          <input
            type="text"
            value={form.subtitle}
            onChange={(e) => set("subtitle", e.target.value)}
            placeholder="Optional subtitle or series info"
            className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm
                       focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-400"
          />
        </div>

        {/* ISBN + SKU side by side */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              ISBN
            </label>
            <input
              type="text"
              value={form.isbn}
              onChange={(e) => set("isbn", e.target.value)}
              placeholder="978-..."
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              SKU
            </label>
            <input
              type="text"
              value={form.sku}
              onChange={(e) => set("sku", e.target.value)}
              placeholder="Your internal code"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-400"
            />
          </div>
        </div>

        {/* Published date + Status side by side */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Published date
            </label>
            <input
              type="date"
              value={form.publishedAt}
              onChange={(e) => set("publishedAt", e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm
                         focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Status
            </label>
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm bg-white
                         focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Description
          </label>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={3}
            placeholder="Optional notes about this product"
            className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm resize-none
                       focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-400"
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
          disabled={isPending || !form.title}
          className="flex-1 py-2 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400
                     text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isPending ? "Saving…" : "Save product"}
        </button>
      </div>
    </form>
  );
}

// ── Slide-over panel ───────────────────────────────────────────────────────────

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
    // Backdrop
    <div className="fixed inset-0 z-40 flex">
      <div
        className="fixed inset-0 bg-black/30"
        onClick={onClose}
      />
      {/* Panel */}
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
        <div className="flex-1 overflow-hidden flex flex-col">
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Product | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  // Fetch products list
  const { data: products = [], isLoading, error } = useQuery({
    queryKey: ["products"],
    queryFn: productsApi.list,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: productsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setAddingNew(false);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ProductFormData> }) =>
      productsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setEditing(null);
    },
  });

  // Archive mutation
  const archiveMutation = useMutation({
    mutationFn: productsApi.archive,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });

  function openEdit(product: Product) {
    setEditing(product);
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
  const panelTitle = editing ? "Edit product" : "New product";

  const formInitial: ProductFormData = editing
    ? {
        type: editing.type,
        title: editing.title,
        subtitle: editing.subtitle ?? "",
        isbn: editing.isbn ?? "",
        sku: editing.sku ?? "",
        description: editing.description ?? "",
        publishedAt: editing.publishedAt ?? "",
        status: editing.status,
      }
    : EMPTY_FORM;

  function handleSave(data: ProductFormData) {
    // Strip empty strings → undefined so the API gets clean nulls
    const clean = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, v === "" ? undefined : v])
    ) as ProductFormData;

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

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Products</h1>
          <p className="text-sm text-gray-400 mt-0.5">Books, prints, merch, and services</p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium
                     rounded-lg transition-colors"
        >
          + New product
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-sm text-red-700">
          Failed to load products. {(error as Error).message}
        </div>
      ) : products.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <p className="text-gray-400 text-sm mb-3">No products yet.</p>
          <button
            onClick={openNew}
            className="text-indigo-600 text-sm font-medium hover:underline"
          >
            Add your first product →
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Title</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">ISBN / SKU</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Published</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{p.title}</div>
                    {p.subtitle && (
                      <div className="text-xs text-gray-400 mt-0.5">{p.subtitle}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      label={p.type.charAt(0).toUpperCase() + p.type.slice(1)}
                      className={TYPE_COLORS[p.type]}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      label={p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                      className={STATUS_COLORS[p.status]}
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {p.isbn ?? p.sku ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {p.publishedAt
                      ? new Date(p.publishedAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                        })
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(p)}
                      className="text-indigo-600 hover:text-indigo-800 text-xs font-medium mr-3"
                    >
                      Edit
                    </button>
                    {p.status !== "archived" && (
                      <button
                        onClick={() => {
                          if (confirm(`Archive "${p.title}"?`)) {
                            archiveMutation.mutate(p.id);
                          }
                        }}
                        className="text-gray-400 hover:text-red-600 text-xs"
                      >
                        Archive
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit slide-over */}
      <SlideOver open={panelOpen} title={panelTitle} onClose={closePanel}>
        <ProductForm
          key={editing?.id ?? "new"}
          initial={formInitial}
          onSave={handleSave}
          onCancel={closePanel}
          isPending={mutationPending}
          error={mutationError}
        />
      </SlideOver>
    </div>
  );
}

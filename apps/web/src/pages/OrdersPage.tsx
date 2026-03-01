// OrdersPage — order tracking for the catalog.
//
// Sections:
//   • Status tabs (All / Pending / Processing / Shipped / Delivered / Cancelled)
//   • Order list — order number, customer, date, total, status badge
//   • Slide-over form — create or edit an order with line items
//   • Detail panel — clicking an order opens full detail (items, shipping, notes)

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

interface OrderItem {
  id: string;
  productId?: string | null;
  title: string;
  quantity: number;
  unitPrice: number;
  variant?: string | null;
}

interface Order {
  id: string;
  orderNumber: string;
  source: string;
  status: string;
  customerName: string;
  customerEmail?: string | null;
  shipToLine1?: string | null;
  shipToLine2?: string | null;
  shipToCity?: string | null;
  shipToState?: string | null;
  shipToZip?: string | null;
  shipToCountry?: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  subtotal: number;
  shippingCost: number;
  taxAmount: number;
  total: number;
  customerNote?: string | null;
  internalNote?: string | null;
  orderedAt: string;
  dueDate?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  items?: OrderItem[];
}

interface Product {
  id: string;
  title: string;
  type: string;
  status: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function fmtDate(iso: string) {
  return new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  processing: "bg-blue-100 text-blue-700",
  shipped: "bg-indigo-100 text-indigo-700",
  delivered: "bg-green-100 text-green-700",
  cancelled: "bg-gray-100 text-gray-500",
  refunded: "bg-red-100 text-red-600",
};

const ALL_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled", "refunded"];

// ── Slide-over ─────────────────────────────────────────────────────────────────

function SlideOver({ open, onClose, children }: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-xl bg-white shadow-xl flex flex-col h-full">
        {children}
      </div>
    </div>
  );
}

// ── Order detail panel ─────────────────────────────────────────────────────────

function OrderDetail({
  order,
  onClose,
  onEdit,
  onStatusChange,
}: {
  order: Order;
  onClose: () => void;
  onEdit: () => void;
  onStatusChange: (status: string) => void;
}) {
  // Fetch full detail (with items) on mount
  const { data: detail } = useQuery({
    queryKey: ["orders", order.id],
    queryFn: () => apiFetch<Order>(`/api/orders/${order.id}`),
  });

  const o = detail ?? order;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{o.orderNumber}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{o.customerName}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onEdit}
            className="text-xs text-indigo-600 hover:underline font-medium"
          >
            Edit
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {/* Status + dates */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Status</p>
          <div className="flex flex-wrap gap-2">
            {ALL_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => onStatusChange(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                  o.status === s
                    ? STATUS_COLORS[s] + " border-transparent"
                    : "border-gray-200 text-gray-500 hover:border-gray-300"
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Key dates */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-400">Ordered</p>
            <p className="font-medium text-gray-900">{fmtDate(o.orderedAt)}</p>
          </div>
          {o.dueDate && (
            <div>
              <p className="text-xs text-gray-400">Ship by</p>
              <p className="font-medium text-gray-900">{fmtDate(o.dueDate)}</p>
            </div>
          )}
          {o.shippedAt && (
            <div>
              <p className="text-xs text-gray-400">Shipped</p>
              <p className="font-medium text-gray-900">{fmtDate(o.shippedAt)}</p>
            </div>
          )}
          {o.deliveredAt && (
            <div>
              <p className="text-xs text-gray-400">Delivered</p>
              <p className="font-medium text-gray-900">{fmtDate(o.deliveredAt)}</p>
            </div>
          )}
        </div>

        {/* Line items */}
        {o.items && o.items.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Items</p>
            <div className="bg-gray-50 rounded-lg divide-y divide-gray-200">
              {o.items.map((item) => (
                <div key={item.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-900">{item.title}</p>
                    {item.variant && <p className="text-xs text-gray-400">{item.variant}</p>}
                  </div>
                  <div className="text-right text-sm">
                    <p className="text-gray-600">{item.quantity} × {fmt(item.unitPrice)}</p>
                    <p className="font-medium text-gray-900">{fmt(item.quantity * item.unitPrice)}</p>
                  </div>
                </div>
              ))}
              <div className="px-4 py-3 space-y-1 text-sm">
                <div className="flex justify-between text-gray-500">
                  <span>Subtotal</span><span>{fmt(o.subtotal)}</span>
                </div>
                {o.shippingCost > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <span>Shipping</span><span>{fmt(o.shippingCost)}</span>
                  </div>
                )}
                {o.taxAmount > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <span>Tax</span><span>{fmt(o.taxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-gray-900 border-t border-gray-200 pt-2 mt-1">
                  <span>Total</span><span>{fmt(o.total)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Shipping address */}
        {(o.shipToLine1 || o.shipToCity) && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Ship to</p>
            <address className="not-italic text-sm text-gray-700 leading-relaxed">
              {o.customerName}<br />
              {o.shipToLine1 && <>{o.shipToLine1}<br /></>}
              {o.shipToLine2 && <>{o.shipToLine2}<br /></>}
              {[o.shipToCity, o.shipToState, o.shipToZip].filter(Boolean).join(", ")}
              {o.shipToCountry && <><br />{o.shipToCountry}</>}
            </address>
          </div>
        )}

        {/* Tracking */}
        {o.trackingNumber && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Tracking</p>
            <p className="text-sm text-gray-700">
              {o.carrier && <span className="text-gray-500 mr-1">{o.carrier}</span>}
              {o.trackingNumber}
            </p>
          </div>
        )}

        {/* Notes */}
        {(o.customerNote || o.internalNote) && (
          <div className="space-y-3">
            {o.customerNote && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Customer note</p>
                <p className="text-sm text-gray-700 bg-amber-50 rounded-lg px-3 py-2">{o.customerNote}</p>
              </div>
            )}
            {o.internalNote && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Internal note</p>
                <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">{o.internalNote}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Order form (create / edit) ─────────────────────────────────────────────────

interface ItemRow {
  productId: string;
  title: string;
  quantity: number;
  unitPrice: number;
  variant: string;
}

const emptyItem = (): ItemRow => ({ productId: "", title: "", quantity: 1, unitPrice: 0, variant: "" });

function OrderForm({
  initial,
  products,
  onSave,
  onClose,
}: {
  initial?: Order;
  products: Product[];
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    customerName: initial?.customerName ?? "",
    customerEmail: initial?.customerEmail ?? "",
    orderedAt: initial?.orderedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    dueDate: initial?.dueDate ?? "",
    status: initial?.status ?? "pending",
    shipToLine1: initial?.shipToLine1 ?? "",
    shipToLine2: initial?.shipToLine2 ?? "",
    shipToCity: initial?.shipToCity ?? "",
    shipToState: initial?.shipToState ?? "",
    shipToZip: initial?.shipToZip ?? "",
    shipToCountry: initial?.shipToCountry ?? "",
    trackingNumber: initial?.trackingNumber ?? "",
    carrier: initial?.carrier ?? "",
    shippingCost: String(initial?.shippingCost ?? 0),
    taxAmount: String(initial?.taxAmount ?? 0),
    customerNote: initial?.customerNote ?? "",
    internalNote: initial?.internalNote ?? "",
  });

  const [items, setItems] = useState<ItemRow[]>(
    initial?.items?.map((i) => ({
      productId: i.productId ?? "",
      title: i.title,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      variant: i.variant ?? "",
    })) ?? [emptyItem()]
  );

  const set = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  const updateItem = (idx: number, field: keyof ItemRow, value: string | number) => {
    setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const pickProduct = (idx: number, productId: string) => {
    const p = products.find((p) => p.id === productId);
    setItems((rows) =>
      rows.map((r, i) =>
        i === idx ? { ...r, productId, title: p?.title ?? r.title } : r
      )
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...form,
      shippingCost: parseFloat(form.shippingCost) || 0,
      taxAmount: parseFloat(form.taxAmount) || 0,
      dueDate: form.dueDate || undefined,
      items: items.filter((i) => i.title.trim()).map((i) => ({
        ...i,
        productId: i.productId || undefined,
        variant: i.variant || undefined,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
      })),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900">
          {initial ? "Edit Order" : "New Order"}
        </h2>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* Customer */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Customer</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-gray-500 block mb-1">Name *</label>
              <input
                required
                value={form.customerName}
                onChange={(e) => set("customerName", e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Jane Smith"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500 block mb-1">Email</label>
              <input
                type="email"
                value={form.customerEmail}
                onChange={(e) => set("customerEmail", e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="jane@example.com"
              />
            </div>
          </div>
        </section>

        {/* Shipping address */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Shipping address</p>
          <div className="space-y-2">
            <input
              value={form.shipToLine1}
              onChange={(e) => set("shipToLine1", e.target.value)}
              placeholder="Address line 1"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              value={form.shipToLine2}
              onChange={(e) => set("shipToLine2", e.target.value)}
              placeholder="Address line 2 (apt, suite…)"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                value={form.shipToCity}
                onChange={(e) => set("shipToCity", e.target.value)}
                placeholder="City"
                className="col-span-2 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                value={form.shipToState}
                onChange={(e) => set("shipToState", e.target.value)}
                placeholder="State"
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={form.shipToZip}
                onChange={(e) => set("shipToZip", e.target.value)}
                placeholder="ZIP / Postal"
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                value={form.shipToCountry}
                onChange={(e) => set("shipToCountry", e.target.value)}
                placeholder="Country"
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </section>

        {/* Line items */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Items</p>
            <button
              type="button"
              onClick={() => setItems((r) => [...r, emptyItem()])}
              className="text-xs text-indigo-600 hover:underline"
            >
              + Add item
            </button>
          </div>
          <div className="space-y-3">
            {items.map((item, idx) => (
              <div key={idx} className="bg-gray-50 rounded-lg p-3 space-y-2">
                <div className="flex gap-2">
                  <select
                    value={item.productId}
                    onChange={(e) => pickProduct(idx, e.target.value)}
                    className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">— Select product —</option>
                    {products.filter(p => p.status === "active").map((p) => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setItems((r) => r.filter((_, i) => i !== idx))}
                    className="text-gray-400 hover:text-red-500 text-sm px-1"
                    title="Remove item"
                  >×</button>
                </div>
                <input
                  value={item.title}
                  onChange={(e) => updateItem(idx, "title", e.target.value)}
                  placeholder="Item name / description *"
                  required
                  className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-gray-400">Qty</label>
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => updateItem(idx, "quantity", parseInt(e.target.value) || 1)}
                      className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-gray-400">Unit price</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.unitPrice}
                      onChange={(e) => updateItem(idx, "unitPrice", parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
                <input
                  value={item.variant}
                  onChange={(e) => updateItem(idx, "variant", e.target.value)}
                  placeholder="Variant (signed, size…)"
                  className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            ))}
          </div>
        </section>

        {/* Financials */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Financials</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Shipping cost</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.shippingCost}
                onChange={(e) => set("shippingCost", e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Tax</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.taxAmount}
                onChange={(e) => set("taxAmount", e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </section>

        {/* Fulfillment */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Fulfillment</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Order date *</label>
              <input
                type="date"
                required
                value={form.orderedAt}
                onChange={(e) => set("orderedAt", e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">
                Ship-by date
                {!initial && form.dueDate && (
                  <span className="ml-1 text-indigo-500">(auto-tasks ✓)</span>
                )}
              </label>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => set("dueDate", e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Carrier</label>
              <input
                value={form.carrier}
                onChange={(e) => set("carrier", e.target.value)}
                placeholder="USPS, UPS…"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Tracking #</label>
              <input
                value={form.trackingNumber}
                onChange={(e) => set("trackingNumber", e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </section>

        {/* Status (edit only) */}
        {initial && (
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Status</p>
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </section>
        )}

        {/* Notes */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Notes</p>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Customer note</label>
              <textarea
                value={form.customerNote}
                onChange={(e) => set("customerNote", e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                placeholder="Gift message, special instructions…"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Internal note</label>
              <textarea
                value={form.internalNote}
                onChange={(e) => set("internalNote", e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                placeholder="Packing notes, issues…"
              />
            </div>
          </div>
        </section>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          {initial ? "Save changes" : "Create order"}
        </button>
      </div>
    </form>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

type FilterTab = "all" | "pending" | "processing" | "shipped" | "delivered" | "cancelled";

const TABS: { value: FilterTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

export default function OrdersPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<FilterTab>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiFetch<Order[]>("/api/orders"),
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => apiFetch<Product[]>("/api/products"),
  });

  const createOrder = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch<Order>("/api/orders", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      setFormOpen(false);
    },
  });

  const updateOrder = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiFetch<Order>(`/api/orders/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: (order) => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["orders", order.id] });
      setFormOpen(false);
      setEditingOrder(null);
    },
  });

  const patchStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch<Order>(`/api/orders/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: (order) => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["orders", order.id] });
    },
  });

  const deleteOrder = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/orders/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      setSelectedId(null);
    },
  });

  const filtered = useMemo(
    () => (tab === "all" ? orders : orders.filter((o) => o.status === tab)),
    [orders, tab]
  );

  const selectedOrder = orders.find((o) => o.id === selectedId) ?? null;

  function openEdit(order: Order) {
    setEditingOrder(order);
    setFormOpen(true);
  }

  function handleSave(data: Record<string, unknown>) {
    if (editingOrder) {
      updateOrder.mutate({ id: editingOrder.id, data });
    } else {
      createOrder.mutate(data);
    }
  }

  // Summary counts
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [orders]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Orders</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {orders.length} total · {counts.pending ?? 0} pending · {counts.processing ?? 0} processing
          </p>
        </div>
        <button
          onClick={() => { setEditingOrder(null); setFormOpen(true); }}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + New order
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-6 w-fit">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t.value
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
            {t.value !== "all" && counts[t.value] ? (
              <span className="ml-1.5 text-xs text-gray-400">{counts[t.value]}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Order list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-200 py-20 text-center">
          <p className="text-gray-400 text-sm">
            {tab === "all" ? "No orders yet. Create one to get started." : `No ${tab} orders.`}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {filtered.map((order) => (
            <button
              key={order.id}
              onClick={() => setSelectedId(order.id === selectedId ? null : order.id)}
              className={`w-full text-left px-5 py-4 hover:bg-gray-50 transition-colors flex items-center gap-4 ${
                selectedId === order.id ? "bg-indigo-50" : ""
              }`}
            >
              {/* Order # + source */}
              <div className="w-28 flex-shrink-0">
                <p className="text-sm font-semibold text-gray-900">{order.orderNumber}</p>
                {order.source !== "manual" && (
                  <p className="text-xs text-gray-400 capitalize">{order.source}</p>
                )}
              </div>

              {/* Customer */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 truncate">{order.customerName}</p>
                {order.customerEmail && (
                  <p className="text-xs text-gray-400 truncate">{order.customerEmail}</p>
                )}
              </div>

              {/* Date */}
              <div className="w-28 flex-shrink-0 text-right hidden sm:block">
                <p className="text-xs text-gray-500">{fmtDate(order.orderedAt)}</p>
                {order.dueDate && (
                  <p className="text-xs text-gray-400">Ship by {fmtDate(order.dueDate)}</p>
                )}
              </div>

              {/* Total */}
              <div className="w-20 flex-shrink-0 text-right">
                <p className="text-sm font-medium text-gray-900">{fmt(order.total)}</p>
              </div>

              {/* Status badge */}
              <div className="w-24 flex-shrink-0 flex justify-end">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.status]}`}>
                  {STATUS_LABEL[order.status]}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Detail panel — shown inline below the selected row on mobile, side panel on desktop */}
      {selectedOrder && (
        <div className="mt-4 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <OrderDetail
            order={selectedOrder}
            onClose={() => setSelectedId(null)}
            onEdit={() => openEdit(selectedOrder)}
            onStatusChange={(status) => patchStatus.mutate({ id: selectedOrder.id, status })}
          />
          {/* Delete option */}
          <div className="border-t border-gray-100 px-6 py-3 flex justify-end">
            <button
              onClick={() => {
                if (confirm(`Delete order ${selectedOrder.orderNumber}? This cannot be undone.`)) {
                  deleteOrder.mutate(selectedOrder.id);
                }
              }}
              className="text-xs text-red-500 hover:text-red-700"
            >
              Delete order
            </button>
          </div>
        </div>
      )}

      {/* Create / edit slide-over */}
      <SlideOver open={formOpen} onClose={() => { setFormOpen(false); setEditingOrder(null); }}>
        <OrderForm
          initial={editingOrder ?? undefined}
          products={products}
          onSave={handleSave}
          onClose={() => { setFormOpen(false); setEditingOrder(null); }}
        />
      </SlideOver>
    </div>
  );
}

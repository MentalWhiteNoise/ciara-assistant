// Order routes:
//   GET    /api/orders             — list orders (filter by status, source)
//   POST   /api/orders             — create order + auto-generate tasks/event
//   GET    /api/orders/:id         — get one order with its line items
//   PUT    /api/orders/:id         — update order fields
//   PATCH  /api/orders/:id/status  — quick status update (e.g. "shipped")
//   DELETE /api/orders/:id         — delete order (cascades to items + linked tasks)

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ulid } from "ulid";
import { db, rawDb } from "../db/client.js";
import { orders, orderItems, tasks, calendarEvents } from "../db/schema/index.js";
import { eq, desc, and, inArray } from "drizzle-orm";

// ── Zod schemas ────────────────────────────────────────────────────────────────

const OrderStatusSchema = z.enum([
  "pending", "processing", "shipped", "delivered", "cancelled", "refunded",
]);

const OrderItemSchema = z.object({
  productId: z.string().optional(),
  title: z.string().min(1, "Item title is required"),
  quantity: z.number().int().positive().default(1),
  unitPrice: z.number().nonnegative().default(0),
  variant: z.string().optional(),
});

const CreateOrderSchema = z.object({
  orderNumber: z.string().optional(),  // auto-generated if omitted
  source: z.enum(["manual", "squarespace", "etsy", "shopify", "other"]).default("manual"),
  externalId: z.string().optional(),
  status: OrderStatusSchema.default("pending"),
  customerName: z.string().min(1, "Customer name is required"),
  customerEmail: z.string().email().optional(),
  shipToLine1: z.string().optional(),
  shipToLine2: z.string().optional(),
  shipToCity: z.string().optional(),
  shipToState: z.string().optional(),
  shipToZip: z.string().optional(),
  shipToCountry: z.string().optional(),
  trackingNumber: z.string().optional(),
  carrier: z.string().optional(),
  shippingCost: z.number().nonnegative().default(0),
  taxAmount: z.number().nonnegative().default(0),
  customerNote: z.string().optional(),
  internalNote: z.string().optional(),
  orderedAt: z.string(),         // ISO date or datetime
  dueDate: z.string().optional(), // ship-by date
  items: z.array(OrderItemSchema).default([]),
});

const UpdateOrderSchema = CreateOrderSchema.omit({ items: true }).partial();

// ── Helpers ────────────────────────────────────────────────────────────────────

// Generate next ORD-NNNN number based on existing orders
function nextOrderNumber(): string {
  const last = rawDb
    .prepare(
      `SELECT order_number FROM orders
       WHERE order_number LIKE 'ORD-%'
       ORDER BY order_number DESC LIMIT 1`
    )
    .get() as { order_number: string } | undefined;

  if (!last) return "ORD-0001";
  const num = parseInt(last.order_number.replace("ORD-", ""), 10);
  return `ORD-${String(num + 1).padStart(4, "0")}`;
}

// Create the 3 standard fulfillment tasks + calendar event for an order.
// Wrapped in a transaction so either all succeed or none do.
function createOrderTasks(orderId: string, orderNumber: string, customerName: string, dueDate: string) {
  const now = new Date().toISOString();

  const taskDefs = [
    { title: `Pick & pack: ${orderNumber}`, priority: "high" as const, offsetDays: 0 },
    { title: `Ship: ${orderNumber} → ${customerName}`, priority: "high" as const, offsetDays: 0 },
    { title: `Confirm delivery: ${orderNumber}`, priority: "medium" as const, offsetDays: 3 },
  ];

  const txn = rawDb.transaction(() => {
    for (const t of taskDefs) {
      const due = offsetDate(dueDate, t.offsetDays);
      rawDb.prepare(`
        INSERT INTO tasks (id, title, status, priority, due_date, scheduled_date, order_id, created_at, updated_at)
        VALUES (?, ?, 'todo', ?, ?, ?, ?, ?, ?)
      `).run(ulid(), t.title, t.priority, due, due, orderId, now, now);
    }

    // Calendar event on the due date
    rawDb.prepare(`
      INSERT INTO calendar_events (id, title, all_day, start_at, end_at, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?, ?, ?)
    `).run(
      ulid(),
      `Ship by: ${customerName} (${orderNumber})`,
      dueDate,
      dueDate,
      now,
      now,
    );
  });

  txn();
}

function offsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function withItems(order: typeof orders.$inferSelect) {
  const items = db.select().from(orderItems).where(eq(orderItems.orderId, order.id)).all();
  return { ...order, items };
}

// ── Route registration ─────────────────────────────────────────────────────────

export async function orderRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // ── GET /api/orders ──────────────────────────────────────────────────────────
  // Query: status, source
  app.get("/", async (request) => {
    const { status, source } = request.query as {
      status?: string;
      source?: string;
    };

    let rows = db.select().from(orders).orderBy(desc(orders.orderedAt)).all();

    if (status) rows = rows.filter((o) => o.status === status);
    if (source) rows = rows.filter((o) => o.source === source);

    return rows;
  });

  // ── GET /api/orders/:id ──────────────────────────────────────────────────────
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = db.select().from(orders).where(eq(orders.id, id)).get();
    if (!order) return reply.code(404).send({ error: "Order not found" });
    return withItems(order);
  });

  // ── POST /api/orders ─────────────────────────────────────────────────────────
  app.post("/", async (request, reply) => {
    const body = CreateOrderSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    const { items, orderNumber: suppliedNum, ...rest } = body.data;
    const now = new Date().toISOString();
    const id = ulid();
    const orderNumber = suppliedNum ?? nextOrderNumber();

    // Calculate subtotal from items
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const total = subtotal + rest.shippingCost + rest.taxAmount;

    // Insert order + items in a transaction, then auto-create tasks if dueDate given
    const txn = rawDb.transaction(() => {
      rawDb.prepare(`
        INSERT INTO orders (
          id, order_number, source, external_id, status,
          customer_name, customer_email,
          ship_to_line1, ship_to_line2, ship_to_city, ship_to_state, ship_to_zip, ship_to_country,
          tracking_number, carrier,
          subtotal, shipping_cost, tax_amount, total,
          customer_note, internal_note,
          ordered_at, due_date,
          created_at, updated_at
        ) VALUES (
          ?,?,?,?,?,
          ?,?,
          ?,?,?,?,?,?,
          ?,?,
          ?,?,?,?,
          ?,?,
          ?,?,
          ?,?
        )
      `).run(
        id, orderNumber, rest.source, rest.externalId ?? null, rest.status,
        rest.customerName, rest.customerEmail ?? null,
        rest.shipToLine1 ?? null, rest.shipToLine2 ?? null, rest.shipToCity ?? null,
        rest.shipToState ?? null, rest.shipToZip ?? null, rest.shipToCountry ?? null,
        rest.trackingNumber ?? null, rest.carrier ?? null,
        subtotal, rest.shippingCost, rest.taxAmount, total,
        rest.customerNote ?? null, rest.internalNote ?? null,
        rest.orderedAt, rest.dueDate ?? null,
        now, now,
      );

      for (const item of items) {
        rawDb.prepare(`
          INSERT INTO order_items (id, order_id, product_id, title, quantity, unit_price, variant)
          VALUES (?,?,?,?,?,?,?)
        `).run(
          ulid(), id,
          item.productId ?? null,
          item.title,
          item.quantity,
          item.unitPrice,
          item.variant ?? null,
        );
      }
    });

    txn();

    // Auto-generate fulfillment tasks + calendar event if due date is set
    if (rest.dueDate) {
      createOrderTasks(id, orderNumber, rest.customerName, rest.dueDate);
    }

    const order = db.select().from(orders).where(eq(orders.id, id)).get()!;
    return reply.code(201).send(withItems(order));
  });

  // ── PUT /api/orders/:id ──────────────────────────────────────────────────────
  app.put("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db.select().from(orders).where(eq(orders.id, id)).get();
    if (!existing) return reply.code(404).send({ error: "Order not found" });

    const body = UpdateOrderSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    const updates: Record<string, unknown> = {
      ...body.data,
      updatedAt: new Date().toISOString(),
    };

    // Auto-stamp shippedAt when status → shipped
    if (body.data.status === "shipped" && existing.status !== "shipped") {
      updates.shippedAt = new Date().toISOString();
    }

    db.update(orders).set(updates).where(eq(orders.id, id)).run();

    const order = db.select().from(orders).where(eq(orders.id, id)).get()!;
    return withItems(order);
  });

  // ── PATCH /api/orders/:id/status ─────────────────────────────────────────────
  app.patch("/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db.select().from(orders).where(eq(orders.id, id)).get();
    if (!existing) return reply.code(404).send({ error: "Order not found" });

    const body = z.object({ status: OrderStatusSchema }).safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    const updates: Record<string, unknown> = {
      status: body.data.status,
      updatedAt: new Date().toISOString(),
    };

    if (body.data.status === "shipped" && existing.status !== "shipped") {
      updates.shippedAt = new Date().toISOString();
    }
    if (body.data.status === "delivered" && !existing.deliveredAt) {
      updates.deliveredAt = new Date().toISOString();
    }

    db.update(orders).set(updates).where(eq(orders.id, id)).run();

    const order = db.select().from(orders).where(eq(orders.id, id)).get()!;
    return withItems(order);
  });

  // ── DELETE /api/orders/:id ───────────────────────────────────────────────────
  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db.select().from(orders).where(eq(orders.id, id)).get();
    if (!existing) return reply.code(404).send({ error: "Order not found" });

    // CASCADE in schema handles order_items + tasks with orderId
    db.delete(orders).where(eq(orders.id, id)).run();
    return reply.code(204).send();
  });
}

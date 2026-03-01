// Products routes:
//   GET    /api/products        — list all products (optionally filter by status)
//   POST   /api/products        — create a new product
//   GET    /api/products/:id    — get one product
//   PUT    /api/products/:id    — update a product
//   DELETE /api/products/:id    — archive a product (soft delete)

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ulid } from "ulid";
import { db } from "../db/client.js";
import { products } from "../db/schema/index.js";
import { eq, asc } from "drizzle-orm";

// ── Zod schemas ────────────────────────────────────────────────────────────────

const ProductTypeSchema = z.enum([
  "book",
  "print",
  "merch",
  "service",
  "commission",
]);

const ProductStatusSchema = z.enum(["active", "archived", "draft"]);

const CreateProductSchema = z.object({
  type: ProductTypeSchema,
  title: z.string().min(1, "Title is required"),
  subtitle: z.string().optional(),
  isbn: z.string().optional(),
  sku: z.string().optional(),
  description: z.string().optional(),
  publishedAt: z.string().optional(), // ISO date string
  status: ProductStatusSchema.default("active"),
});

const UpdateProductSchema = CreateProductSchema.partial();

// ── Route registration ─────────────────────────────────────────────────────────

export async function productRoutes(app: FastifyInstance) {
  // All routes in this plugin require authentication
  app.addHook("preHandler", app.authenticate);

  // ── GET /api/products ────────────────────────────────────────────────────────
  // Returns all products, ordered by title.
  // Optional query param: ?status=active|archived|draft
  // Defaults to returning only active + draft (i.e., not archived).
  app.get("/", async (request) => {
    const { status } = request.query as { status?: string };

    const rows = db
      .select()
      .from(products)
      .orderBy(asc(products.title))
      .all();

    if (status) {
      return rows.filter((p) => p.status === status);
    }

    // Default: exclude archived
    return rows.filter((p) => p.status !== "archived");
  });

  // ── GET /api/products/:id ────────────────────────────────────────────────────
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const product = db.select().from(products).where(eq(products.id, id)).get();

    if (!product) {
      return reply.code(404).send({ error: "Product not found" });
    }

    return product;
  });

  // ── POST /api/products ───────────────────────────────────────────────────────
  app.post("/", async (request, reply) => {
    const body = CreateProductSchema.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    const now = new Date().toISOString();
    const id = ulid();

    db.insert(products)
      .values({
        id,
        ...body.data,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const product = db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .get();

    return reply.code(201).send(product);
  });

  // ── PUT /api/products/:id ────────────────────────────────────────────────────
  app.put("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .get();

    if (!existing) {
      return reply.code(404).send({ error: "Product not found" });
    }

    const body = UpdateProductSchema.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    db.update(products)
      .set({ ...body.data, updatedAt: new Date().toISOString() })
      .where(eq(products.id, id))
      .run();

    const updated = db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .get();

    return updated;
  });

  // ── DELETE /api/products/:id ─────────────────────────────────────────────────
  // Soft delete — sets status to "archived" rather than removing the row.
  // Archived products remain as references on existing transactions.
  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .get();

    if (!existing) {
      return reply.code(404).send({ error: "Product not found" });
    }

    db.update(products)
      .set({ status: "archived", updatedAt: new Date().toISOString() })
      .where(eq(products.id, id))
      .run();

    return reply.code(204).send();
  });
}

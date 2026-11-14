// Shared bookkeeping for book print orders (IngramSpark, 48HR Books, …).
//
// A print order of author copies is an INVENTORY PURCHASE: one expense under
// "Book Inventory Purchases" (Schedule C Part III line 36 — cost of goods), and
// the copies added to "home" stock at their landed cost per copy.
//
// All functions take the open database transaction `tx`, so an importer's
// whole run commits or rolls back together.

import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { attachments, categories, inventoryItems, inventoryMovements, products } from "../db/schema/index.js";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const INVENTORY_CATEGORY = {
  name: "Book Inventory Purchases",
  type: "expense" as const,
  taxLine: "cogs_line_36",
  color: "#a16207",
};
export const STOCK_LOCATION = "home";

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function ensureInventoryCategoryId(tx: Tx): string {
  const found = tx.select({ id: categories.id }).from(categories).where(eq(categories.name, INVENTORY_CATEGORY.name)).get();
  if (found) return found.id;
  const id = ulid();
  tx.insert(categories).values({ id, ...INVENTORY_CATEGORY }).run();
  return id;
}

/** Book format from a printer's binding name/code. */
export function formatFromBinding(binding: string | null | undefined): string | null {
  const b = (binding ?? "").trim().toUpperCase();
  if (["PF", "PERFECT", "PAPERBACK"].includes(b)) return "Paperback";
  if (["TC", "CL", "JC", "CASE", "HARDCOVER", "HARDBACK"].includes(b)) return "Hardcover";
  return null;
}

/** "Blackwarden" + "TC" → "Blackwarden (Hardcover)". Same naming for every printer. */
export function bookProductTitle(title: string, binding: string | null | undefined) {
  const format = formatFromBinding(binding);
  return format ? `${title} (${format})` : title;
}

/** Look up a book by ISBN, then by its exact product title (case-insensitive). */
export function findBook(tx: Tx | typeof db, { isbn, title }: { isbn?: string | null; title: string }) {
  if (isbn) {
    const byIsbn = tx.select({ id: products.id }).from(products).where(eq(products.isbn, isbn)).get();
    if (byIsbn) return byIsbn.id;
  }
  return tx.select({ id: products.id }).from(products)
    .where(and(eq(products.type, "book"), sql`lower(${products.title}) = lower(${title})`)).get()?.id ?? null;
}

export function findOrCreateBook(
  tx: Tx,
  book: { isbn?: string | null; title: string; metadata: Record<string, unknown> }
): string {
  const found = findBook(tx, book);
  if (found) {
    // Learned an ISBN for a book created without one (e.g. by the 48HR import).
    if (book.isbn) {
      tx.update(products).set({ isbn: book.isbn }).where(and(eq(products.id, found), sql`${products.isbn} is null`)).run();
    }
    return found;
  }
  const id = ulid();
  tx.insert(products).values({
    id, type: "book", title: book.title, isbn: book.isbn ?? null, status: "active", metadata: JSON.stringify(book.metadata),
  }).run();
  return id;
}

/** Add copies to home stock (weighted average cost) and log the movement. */
export function receiveStock(
  tx: Tx,
  r: { productId: string; quantity: number; unitCost: number; transactionId: string; occurredAt: string; notes: string }
) {
  let item = tx.select().from(inventoryItems)
    .where(and(eq(inventoryItems.productId, r.productId), eq(inventoryItems.location, STOCK_LOCATION))).get();
  if (!item) {
    const itemId = ulid();
    tx.insert(inventoryItems).values({ id: itemId, productId: r.productId, location: STOCK_LOCATION, onHand: 0 }).run();
    item = tx.select().from(inventoryItems).where(eq(inventoryItems.id, itemId)).get()!;
  }
  // Weighted average cost. With no stock on hand (or no known cost) the new copies set it.
  const before = Math.max(item.onHand, 0);
  const avg = item.costPerUnit != null && before > 0
    ? round4((before * item.costPerUnit + r.quantity * r.unitCost) / (before + r.quantity))
    : r.unitCost;
  tx.update(inventoryItems)
    .set({ onHand: item.onHand + r.quantity, costPerUnit: avg, updatedAt: new Date().toISOString() })
    .where(eq(inventoryItems.id, item.id)).run();
  tx.insert(inventoryMovements).values({
    id: ulid(),
    itemId: item.id,
    movementType: "print_run",
    quantity: r.quantity,
    unitCost: r.unitCost,
    sourceId: r.transactionId,
    sourceType: "transaction",
    notes: r.notes,
    occurredAt: r.occurredAt,
  }).run();
}

/**
 * Copy a kept file into data/attachments and attach it to a transaction.
 * Returns the copied path (so a caller can delete it if its DB transaction
 * rolls back), or null if the source file is missing.
 */
export function attachFile(
  tx: Tx,
  a: { dataDir: string; sourceRelPath: string; transactionId: string; fileType: "receipt" | "invoice"; originalName: string; mimeType: string }
): string | null {
  const src = path.join(a.dataDir, a.sourceRelPath);
  if (!fs.existsSync(src)) return null;
  const dir = path.join(a.dataDir, "attachments");
  fs.mkdirSync(dir, { recursive: true });
  const storedName = `${ulid()}${path.extname(src)}`;
  const dest = path.join(dir, storedName);
  fs.copyFileSync(src, dest);
  tx.insert(attachments).values({
    id: ulid(),
    transactionId: a.transactionId,
    filePath: storedName,
    fileType: a.fileType,
    originalName: a.originalName,
    mimeType: a.mimeType,
    sizeBytes: fs.statSync(src).size,
  }).run();
  return dest;
}

import { z } from "zod";

export const TransactionTypeSchema = z.enum([
  "sale",
  "expense",
  "refund",
  "transfer",
]);

export const TransactionSchema = z.object({
  id: z.string(),
  type: TransactionTypeSchema,
  amount: z.number().positive(),
  currency: z.string().default("USD"),
  description: z.string().min(1),
  categoryId: z.string().nullable().optional(),
  channelId: z.string().nullable().optional(),
  productId: z.string().nullable().optional(),
  eventId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  payee: z.string().nullable().optional(),
  paymentMethod: z.string().nullable().optional(),
  referenceId: z.string().nullable().optional(),
  source: z.string().default("manual"),
  notes: z.string().nullable().optional(),
  isTaxDeductible: z.boolean().default(false),
  taxCategory: z.string().nullable().optional(),
  occurredAt: z.string(), // ISO date string
  importedAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

// Schema for creating a new transaction (id/timestamps generated server-side)
export const CreateTransactionSchema = TransactionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  importedAt: true,
}).extend({
  // attachmentIds: already-uploaded file IDs to link
  attachmentIds: z.array(z.string()).optional(),
});

export const UpdateTransactionSchema = CreateTransactionSchema.partial();

// TypeScript types derived automatically from the Zod schemas
export type Transaction = z.infer<typeof TransactionSchema>;
export type CreateTransaction = z.infer<typeof CreateTransactionSchema>;
export type UpdateTransaction = z.infer<typeof UpdateTransactionSchema>;
export type TransactionType = z.infer<typeof TransactionTypeSchema>;

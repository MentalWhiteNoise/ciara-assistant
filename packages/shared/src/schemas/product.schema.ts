import { z } from "zod";

export const ProductTypeSchema = z.enum([
  "book",
  "print",
  "merch",
  "service",
  "commission",
]);

export const ProductStatusSchema = z.enum(["active", "archived", "draft"]);

export const ProductSchema = z.object({
  id: z.string(),
  type: ProductTypeSchema,
  title: z.string().min(1),
  subtitle: z.string().nullable().optional(),
  isbn: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  coverImage: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  status: ProductStatusSchema.default("active"),
  metadata: z.record(z.unknown()).nullable().optional(), // flexible JSON
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const CreateProductSchema = ProductSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateProductSchema = CreateProductSchema.partial();

export type Product = z.infer<typeof ProductSchema>;
export type CreateProduct = z.infer<typeof CreateProductSchema>;
export type UpdateProduct = z.infer<typeof UpdateProductSchema>;
export type ProductType = z.infer<typeof ProductTypeSchema>;

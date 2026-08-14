import { z } from "zod";

// No z.coerce here -- react-hook-form's useForm<T>() needs the schema's
// input and output types to match (same issue as z.transform(), see
// docs/20-development-progress.md). expectedPrice stays a string through
// validation; numeric conversion happens in the server action instead.
export const createProductSchema = z.object({
  name: z.string().trim().min(1, "Product name is required"),
  expectedPrice: z
    .string()
    .refine(
      (v) => v !== "" && !Number.isNaN(Number(v)) && Number(v) >= 0,
      "Price must be 0 or more"
    ),
  imageUrl: z.union([z.url("Enter a valid image URL"), z.literal("")]),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

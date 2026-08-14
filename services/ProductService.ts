import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, ProductStatus } from "@/types/database.types";

/**
 * ProductService — CRUD and active/inactive/archived lifecycle (never
 * hard-deleted — historical sales keep their own snapshot regardless).
 * See docs/10-products.md.
 *
 * Image handling is currently a plain `image_url` field (a pasted URL),
 * not a Supabase Storage upload widget — that's a deliberate Phase 2a
 * scope cut, not an oversight, so the product-catalog-to-sales-capture
 * loop is real and testable now. Storage-backed image upload (spec
 * S42's square/compressed/lazy-loaded pipeline) is a fast-follow.
 * Bulk upload (spec S45) is a separate, later increment.
 */
export interface CreateProductInput {
  name: string;
  expectedPrice?: number | null;
  showExpectedPrice?: boolean;
  imageUrl?: string | null;
  createdBy: string;
}

export interface Product {
  id: string;
  name: string;
  expectedPrice: number | null;
  showExpectedPrice: boolean;
  imageUrl: string | null;
  displayOrder: number;
  status: ProductStatus;
}

export class ProductService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async create(tenantId: string, input: CreateProductInput): Promise<Product> {
    const { data: maxOrder } = await this.supabase
      .from("products")
      .select("display_order")
      .eq("tenant_id", tenantId)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data, error } = await this.supabase
      .from("products")
      .insert({
        tenant_id: tenantId,
        name: input.name,
        expected_price: input.expectedPrice ?? null,
        show_expected_price: input.showExpectedPrice ?? true,
        image_url: input.imageUrl ?? null,
        display_order: (maxOrder?.display_order ?? -1) + 1,
        created_by: input.createdBy,
      })
      .select("id, name, expected_price, show_expected_price, image_url, display_order, status")
      .single();

    if (error || !data) {
      throw new Error(`ProductService.create: ${error?.message}`);
    }

    return toProduct(data);
  }

  async listActive(tenantId: string): Promise<Product[]> {
    const { data, error } = await this.supabase
      .from("products")
      .select("id, name, expected_price, show_expected_price, image_url, display_order, status")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("display_order", { ascending: true });

    if (error) {
      throw new Error(`ProductService.listActive: ${error.message}`);
    }

    return (data ?? []).map(toProduct);
  }

  async archive(tenantId: string, productId: string): Promise<void> {
    const { error } = await this.supabase
      .from("products")
      .update({ status: "archived" })
      .eq("tenant_id", tenantId)
      .eq("id", productId);

    if (error) {
      throw new Error(`ProductService.archive: ${error.message}`);
    }
  }

  async reorder(_tenantId: string, _orderedProductIds: string[]) {
    throw new Error("ProductService.reorder: not yet implemented (drag-and-drop UI is a later increment)");
  }
}

function toProduct(row: {
  id: string;
  name: string;
  expected_price: number | null;
  show_expected_price: boolean;
  image_url: string | null;
  display_order: number;
  status: ProductStatus;
}): Product {
  return {
    id: row.id,
    name: row.name,
    expectedPrice: row.expected_price,
    showExpectedPrice: row.show_expected_price,
    imageUrl: row.image_url,
    displayOrder: row.display_order,
    status: row.status,
  };
}

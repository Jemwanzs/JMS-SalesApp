import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export type OrderProductStatus = "active" | "archived";

const ORDER_PRODUCT_SELECT =
  "id, name, description, image_storage_path, image_url, minimum_order_amount, status, is_available, display_order, created_at, updated_at";

export interface CreateOrderProductInput {
  name: string;
  description?: string | null;
  minimumOrderAmount: number;
  isAvailable?: boolean;
  displayOrder?: number;
  createdBy: string;
}

export interface UpdateOrderProductInput {
  name: string;
  description?: string | null;
  minimumOrderAmount: number;
  isAvailable?: boolean;
  displayOrder?: number;
}

export interface OrderProduct {
  id: string;
  name: string;
  description: string | null;
  imageStoragePath: string | null;
  imageUrl: string | null;
  minimumOrderAmount: number;
  status: OrderProductStatus;
  isAvailable: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

function toOrderProduct(row: {
  id: string;
  name: string;
  description: string | null;
  image_storage_path: string | null;
  image_url: string | null;
  minimum_order_amount: number | string;
  status: string;
  is_available: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}): OrderProduct {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    imageStoragePath: row.image_storage_path,
    imageUrl: row.image_url,
    minimumOrderAmount: Number(row.minimum_order_amount),
    status: row.status as OrderProductStatus,
    isAvailable: row.is_available,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The Customer Orders module's own product catalogue -- deliberately
 * separate from ProductService (Sales' own catalogue, spec: "must be
 * separate... do not change the existing Sales Product logic"). Plain
 * RLS-gated CRUD, archived not deleted (same reasoning ExpenseItemService/
 * ProductService already follow, so a later-archived product's name/
 * image still resolves via order_items' own snapshots for historical
 * orders). Only Active + Available products are meant to appear on the
 * public storefront -- that filter belongs to the future public-facing
 * read path (Phase 2b), not here; listActive() below is the STAFF-side
 * "active" list (status='active', regardless of is_available), used by
 * the config page which needs to show a temporarily-unavailable product
 * too, not just what a customer would currently see.
 */
export class OrderProductService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listActive(tenantId: string): Promise<OrderProduct[]> {
    const { data, error } = await this.supabase
      .from("order_products")
      .select(ORDER_PRODUCT_SELECT)
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("display_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      throw new Error(`OrderProductService.listActive: ${error.message}`);
    }
    return (data ?? []).map(toOrderProduct);
  }

  /** Active + archived, for the config page -- archived items still show, tagged, so an admin can reactivate one. */
  async listAll(tenantId: string): Promise<OrderProduct[]> {
    const { data, error } = await this.supabase
      .from("order_products")
      .select(ORDER_PRODUCT_SELECT)
      .eq("tenant_id", tenantId)
      .order("display_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      throw new Error(`OrderProductService.listAll: ${error.message}`);
    }
    return (data ?? []).map(toOrderProduct);
  }

  async create(tenantId: string, input: CreateOrderProductInput): Promise<OrderProduct> {
    const { data, error } = await this.supabase
      .from("order_products")
      .insert({
        tenant_id: tenantId,
        name: input.name,
        description: input.description ?? null,
        minimum_order_amount: input.minimumOrderAmount,
        is_available: input.isAvailable ?? true,
        display_order: input.displayOrder ?? 0,
        created_by: input.createdBy,
      })
      .select(ORDER_PRODUCT_SELECT)
      .single();

    if (error || !data) {
      throw new Error(`OrderProductService.create: ${error?.message ?? "no row returned"}`);
    }
    return toOrderProduct(data);
  }

  async update(tenantId: string, orderProductId: string, input: UpdateOrderProductInput): Promise<OrderProduct> {
    const { data, error } = await this.supabase
      .from("order_products")
      .update({
        name: input.name,
        description: input.description ?? null,
        minimum_order_amount: input.minimumOrderAmount,
        is_available: input.isAvailable ?? true,
        display_order: input.displayOrder ?? 0,
      })
      .eq("tenant_id", tenantId)
      .eq("id", orderProductId)
      .select(ORDER_PRODUCT_SELECT)
      .single();

    if (error || !data) {
      throw new Error(`OrderProductService.update: ${error?.message ?? "no row returned"}`);
    }
    return toOrderProduct(data);
  }

  async archive(tenantId: string, orderProductId: string): Promise<void> {
    const { error } = await this.supabase
      .from("order_products")
      .update({ status: "archived" })
      .eq("tenant_id", tenantId)
      .eq("id", orderProductId);

    if (error) {
      throw new Error(`OrderProductService.archive: ${error.message}`);
    }
  }

  async reactivate(tenantId: string, orderProductId: string): Promise<void> {
    const { error } = await this.supabase
      .from("order_products")
      .update({ status: "active" })
      .eq("tenant_id", tenantId)
      .eq("id", orderProductId);

    if (error) {
      throw new Error(`OrderProductService.reactivate: ${error.message}`);
    }
  }

  /** Delete-before-replace, same discipline as TenantService.setLogo -- one image per product, no side table. */
  async setImage(tenantId: string, orderProductId: string, storagePath: string, publicUrl: string): Promise<void> {
    await this.deletePreviousImage(tenantId, orderProductId);

    const { error } = await this.supabase
      .from("order_products")
      .update({ image_url: publicUrl, image_storage_path: storagePath })
      .eq("tenant_id", tenantId)
      .eq("id", orderProductId);

    if (error) {
      throw new Error(`OrderProductService.setImage: ${error.message}`);
    }
  }

  async removeImage(tenantId: string, orderProductId: string): Promise<void> {
    await this.deletePreviousImage(tenantId, orderProductId);

    const { error } = await this.supabase
      .from("order_products")
      .update({ image_url: null, image_storage_path: null })
      .eq("tenant_id", tenantId)
      .eq("id", orderProductId);

    if (error) {
      throw new Error(`OrderProductService.removeImage: ${error.message}`);
    }
  }

  private async deletePreviousImage(tenantId: string, orderProductId: string): Promise<void> {
    const { data: existing } = await this.supabase
      .from("order_products")
      .select("image_storage_path")
      .eq("tenant_id", tenantId)
      .eq("id", orderProductId)
      .maybeSingle();

    if (!existing?.image_storage_path) {
      return;
    }

    const { error } = await this.supabase.storage.from("order-product-images").remove([existing.image_storage_path]);
    if (error) {
      throw new Error(`OrderProductService.deletePreviousImage: ${error.message}`);
    }
  }
}

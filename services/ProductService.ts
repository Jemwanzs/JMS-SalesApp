import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, ProductStatus } from "@/types/database.types";

const PRODUCT_SELECT =
  "id, name, description, expected_price, show_expected_price, show_name_in_photo_view, image_url, display_order, status";
const IMAGE_BUCKET = "product-images";

/**
 * ProductService — CRUD, active/inactive/archived lifecycle (never
 * hard-deleted — historical sales keep their own snapshot regardless),
 * and Storage-backed image upload/replace/remove. See docs/10-products.md.
 *
 * Images live in the `product-images` Storage bucket (migration 0007),
 * path `tenant_id/products/{productId}/{filename}` — the actual file
 * upload happens client-side (features/products/components/
 * product-image-upload.tsx, direct-to-Storage, RLS-enforced), while
 * setImage/removeImage here own the DB bookkeeping (`product_images`
 * row + `products.image_url` cache) AND clean up the storage object a
 * replace/remove leaves behind, so nothing is ever orphaned in Storage
 * once a client call to this service has completed.
 *
 * Bulk upload (spec S45) shipped as Phase 5b (ImportService, `type =
 * 'products'`); reorder() (the other half of S45) is real too, see its
 * own header comment.
 */
export interface CreateProductInput {
  id?: string;
  name: string;
  description?: string | null;
  expectedPrice?: number | null;
  showExpectedPrice?: boolean;
  showNameInPhotoView?: boolean;
  imageUrl?: string | null;
  imageStoragePath?: string | null;
  createdBy: string;
}

export interface UpdateProductInput {
  name: string;
  description?: string | null;
  expectedPrice?: number | null;
  showExpectedPrice?: boolean;
  showNameInPhotoView?: boolean;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  expectedPrice: number | null;
  showExpectedPrice: boolean;
  showNameInPhotoView: boolean;
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
        ...(input.id ? { id: input.id } : {}),
        tenant_id: tenantId,
        name: input.name,
        description: input.description ?? null,
        expected_price: input.expectedPrice ?? null,
        show_expected_price: input.showExpectedPrice ?? true,
        show_name_in_photo_view: input.showNameInPhotoView ?? true,
        image_url: input.imageUrl ?? null,
        display_order: (maxOrder?.display_order ?? -1) + 1,
        created_by: input.createdBy,
      })
      .select(PRODUCT_SELECT)
      .single();

    if (error || !data) {
      throw new Error(`ProductService.create: ${error?.message}`);
    }

    if (input.imageUrl && input.imageStoragePath) {
      const { error: imageError } = await this.supabase.from("product_images").insert({
        tenant_id: tenantId,
        product_id: data.id,
        storage_path: input.imageStoragePath,
        is_primary: true,
      });

      if (imageError) {
        throw new Error(`ProductService.create: ${imageError.message}`);
      }
    }

    return toProduct(data);
  }

  async update(tenantId: string, productId: string, input: UpdateProductInput): Promise<Product> {
    const { data, error } = await this.supabase
      .from("products")
      .update({
        name: input.name,
        description: input.description ?? null,
        expected_price: input.expectedPrice ?? null,
        show_expected_price: input.showExpectedPrice ?? true,
        show_name_in_photo_view: input.showNameInPhotoView ?? true,
      })
      .eq("tenant_id", tenantId)
      .eq("id", productId)
      .select(PRODUCT_SELECT)
      .single();

    if (error || !data) {
      throw new Error(`ProductService.update: ${error?.message}`);
    }

    return toProduct(data);
  }

  async listActive(tenantId: string): Promise<Product[]> {
    const { data, error } = await this.supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("display_order", { ascending: true });

    if (error) {
      throw new Error(`ProductService.listActive: ${error.message}`);
    }

    return (data ?? []).map(toProduct);
  }

  /** Active + inactive, for the product management list — excludes
   * archived (soft-deleted, no longer catalog-managed). */
  async listAll(tenantId: string): Promise<Product[]> {
    const { data, error } = await this.supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("tenant_id", tenantId)
      .in("status", ["active", "inactive"])
      .order("display_order", { ascending: true });

    if (error) {
      throw new Error(`ProductService.listAll: ${error.message}`);
    }

    return (data ?? []).map(toProduct);
  }

  async setStatus(
    tenantId: string,
    productId: string,
    status: Extract<ProductStatus, "active" | "inactive">
  ): Promise<void> {
    const { error } = await this.supabase
      .from("products")
      .update({ status })
      .eq("tenant_id", tenantId)
      .eq("id", productId);

    if (error) {
      throw new Error(`ProductService.setStatus: ${error.message}`);
    }
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

  /**
   * A real, permanent delete -- only for a product with zero sales
   * history (migration 0029). A product that's ever been sold stays
   * archive-only: `sales.product_id` has no cascade/set-null, so even if
   * this app-layer check were somehow wrong, Postgres itself would
   * reject the delete with a foreign-key violation rather than silently
   * orphaning historical sales data.
   */
  async delete(tenantId: string, productId: string): Promise<void> {
    const { data: existingSale, error: checkError } = await this.supabase
      .from("sales")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("product_id", productId)
      .limit(1)
      .maybeSingle();

    if (checkError) {
      throw new Error(`ProductService.delete: ${checkError.message}`);
    }
    if (existingSale) {
      throw new Error("This product has recorded sales and can't be deleted -- archive it instead.");
    }

    await this.deletePrimaryImageRow(tenantId, productId);

    const { error } = await this.supabase
      .from("products")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", productId);

    if (error) {
      throw new Error(`ProductService.delete: ${error.message}`);
    }
  }

  /** Sets (or replaces) a product's primary image. Deletes the previous
   * storage object first if one exists, so a replace never orphans it. */
  async setImage(
    tenantId: string,
    productId: string,
    storagePath: string,
    publicUrl: string
  ): Promise<void> {
    await this.deletePrimaryImageRow(tenantId, productId);

    const { error: imageError } = await this.supabase.from("product_images").insert({
      tenant_id: tenantId,
      product_id: productId,
      storage_path: storagePath,
      is_primary: true,
    });

    if (imageError) {
      throw new Error(`ProductService.setImage: ${imageError.message}`);
    }

    const { error } = await this.supabase
      .from("products")
      .update({ image_url: publicUrl })
      .eq("tenant_id", tenantId)
      .eq("id", productId);

    if (error) {
      throw new Error(`ProductService.setImage: ${error.message}`);
    }
  }

  async removeImage(tenantId: string, productId: string): Promise<void> {
    await this.deletePrimaryImageRow(tenantId, productId);

    const { error } = await this.supabase
      .from("products")
      .update({ image_url: null })
      .eq("tenant_id", tenantId)
      .eq("id", productId);

    if (error) {
      throw new Error(`ProductService.removeImage: ${error.message}`);
    }
  }

  private async deletePrimaryImageRow(tenantId: string, productId: string): Promise<void> {
    const { data: existing } = await this.supabase
      .from("product_images")
      .select("id, storage_path")
      .eq("tenant_id", tenantId)
      .eq("product_id", productId)
      .eq("is_primary", true)
      .maybeSingle();

    if (!existing) {
      return;
    }

    const { error: removeError } = await this.supabase.storage
      .from(IMAGE_BUCKET)
      .remove([existing.storage_path]);

    if (removeError) {
      throw new Error(`ProductService.deletePrimaryImageRow: ${removeError.message}`);
    }

    const { error: deleteRowError } = await this.supabase
      .from("product_images")
      .delete()
      .eq("id", existing.id);

    if (deleteRowError) {
      throw new Error(`ProductService.deletePrimaryImageRow: ${deleteRowError.message}`);
    }
  }

  /**
   * Sets `display_order` to each product's index in `orderedProductIds`
   * (the caller's full, current, already-in-the-desired-order list --
   * see product-management-list.tsx's Move Up/Down buttons, the actual
   * UI for this: press-and-drag doesn't translate well to a ~430px
   * mobile viewport, docs/00's own "mobile-first, always" principle, so
   * this ships as a simpler, equally-real reordering affordance rather
   * than pulling in a drag-and-drop library for a worse touch UX).
   * `products.edit`-gated by RLS (products_update, migration 0005), same
   * permission every other write in this service already uses -- no
   * separate check needed here.
   */
  async reorder(tenantId: string, orderedProductIds: string[]): Promise<void> {
    for (let i = 0; i < orderedProductIds.length; i++) {
      const { error } = await this.supabase
        .from("products")
        .update({ display_order: i })
        .eq("tenant_id", tenantId)
        .eq("id", orderedProductIds[i]);

      if (error) {
        throw new Error(`ProductService.reorder: ${error.message}`);
      }
    }
  }
}

function toProduct(row: {
  id: string;
  name: string;
  description: string | null;
  expected_price: number | null;
  show_expected_price: boolean;
  show_name_in_photo_view: boolean;
  image_url: string | null;
  display_order: number;
  status: ProductStatus;
}): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    expectedPrice: row.expected_price,
    showExpectedPrice: row.show_expected_price,
    showNameInPhotoView: row.show_name_in_photo_view,
    imageUrl: row.image_url,
    displayOrder: row.display_order,
    status: row.status,
  };
}

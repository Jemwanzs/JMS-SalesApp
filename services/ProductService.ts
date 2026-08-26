import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, ProductStatus } from "@/types/database.types";

const PRODUCT_SELECT =
  "id, name, description, expected_price, show_expected_price, show_name_in_photo_view, image_url, display_order, status, is_system, tracks_inventory, unit_of_measure, unit_of_measure_is_custom, low_stock_threshold, sku";
const IMAGE_BUCKET = "product-images";
export const OTHERS_PRODUCT_NAME = "Others";

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
  tracksInventory?: boolean;
  unitOfMeasure?: string | null;
  unitOfMeasureIsCustom?: boolean;
  lowStockThreshold?: number | null;
}

export interface UpdateProductInput {
  name: string;
  description?: string | null;
  expectedPrice?: number | null;
  showExpectedPrice?: boolean;
  showNameInPhotoView?: boolean;
  tracksInventory?: boolean;
  unitOfMeasure?: string | null;
  unitOfMeasureIsCustom?: boolean;
  lowStockThreshold?: number | null;
  /** Barcode/QR readiness (Product Enhancements #8) -- no scanner integration yet, just somewhere for a value to live. */
  sku?: string | null;
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
  isSystem: boolean;
  tracksInventory: boolean;
  unitOfMeasure: string | null;
  unitOfMeasureIsCustom: boolean;
  lowStockThreshold: number | null;
  sku: string | null;
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
        tracks_inventory: input.tracksInventory ?? false,
        unit_of_measure: input.unitOfMeasure ?? null,
        unit_of_measure_is_custom: input.unitOfMeasureIsCustom ?? false,
        low_stock_threshold: input.lowStockThreshold ?? null,
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

    await this.ensureOthersProduct(tenantId, input.createdBy);

    return toProduct(data);
  }

  /**
   * Turning the Inventory module on left every product a tenant created
   * BEFORE that moment permanently invisible on the Stock page -- new
   * products default to tracks_inventory=false (Phase 5's deliberate
   * per-product opt-in), and nothing ever went back to flip it for
   * products that already existed, so a tenant who just enabled the
   * module saw an empty Stock list despite having a full catalog. Called
   * once from setInventoryEnabledAction's enable path: gives every
   * active, non-system product without tracking yet a default UOM
   * ("pcs", the first Count-category code -- reasonable for most retail
   * goods, and always editable per-product afterward) so it shows up
   * immediately with a real (zero) balance instead of staying hidden
   * until someone finds the per-product edit form. Products that
   * already opted in (tracks_inventory=true) are left untouched, so a
   * tenant's own choice of UOM/threshold is never clobbered by a repeat
   * toggle-off-then-on.
   */
  async enableTrackingForExistingProducts(tenantId: string, defaultUnitOfMeasure = "pcs"): Promise<void> {
    const { error } = await this.supabase
      .from("products")
      .update({ tracks_inventory: true, unit_of_measure: defaultUnitOfMeasure })
      .eq("tenant_id", tenantId)
      .eq("tracks_inventory", false)
      .eq("is_system", false)
      .eq("status", "active");

    if (error) {
      throw new Error(`ProductService.enableTrackingForExistingProducts: ${error.message}`);
    }
  }

  /**
   * The system "Others" product (spec: Product Enhancements #2) --
   * ensured (not just created once) alongside every real product create
   * so it's always present from the tenant's first product onward,
   * idempotent via products_one_system_per_tenant (migration 0032):
   * a concurrent call racing this insert just loses the unique-index
   * collision harmlessly, since some call always wins and the "does one
   * already exist" check above is what every caller actually relies on.
   */
  private async ensureOthersProduct(tenantId: string, createdBy: string): Promise<void> {
    const { data: existing } = await this.supabase
      .from("products")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("is_system", true)
      .maybeSingle();

    if (existing) {
      return;
    }

    const { error } = await this.supabase.from("products").insert({
      tenant_id: tenantId,
      name: OTHERS_PRODUCT_NAME,
      is_system: true,
      status: "active",
      show_expected_price: false,
      show_name_in_photo_view: true,
      display_order: 0,
      created_by: createdBy,
    });

    if (error && error.code !== "23505") {
      throw new Error(`ProductService.ensureOthersProduct: ${error.message}`);
    }
  }

  /** "Others" (is_system) can't be edited, deactivated, archived, or
   * deleted -- see products_one_system_per_tenant's header comment. */
  private async assertNotSystem(tenantId: string, productId: string): Promise<void> {
    const { data } = await this.supabase
      .from("products")
      .select("is_system")
      .eq("tenant_id", tenantId)
      .eq("id", productId)
      .maybeSingle();

    if (data?.is_system) {
      throw new Error('The "Others" product can\'t be edited or deleted.');
    }
  }

  async update(tenantId: string, productId: string, input: UpdateProductInput): Promise<Product> {
    await this.assertNotSystem(tenantId, productId);

    // Every field above this comment is unconditionally rewritten on
    // every call (the existing pattern -- every current caller always
    // sends the product's full current state back, never a partial
    // patch). The inventory fields below are a deliberate exception:
    // included only when the caller actually passes them, so a plain
    // name/description edit through the product form that doesn't yet
    // know about Inventory (Phase 6 adds that) can never silently wipe
    // out a tracks_inventory/unit_of_measure value set elsewhere.
    const inventoryFields: Record<string, unknown> = {};
    if (input.tracksInventory !== undefined) inventoryFields.tracks_inventory = input.tracksInventory;
    if (input.unitOfMeasure !== undefined) inventoryFields.unit_of_measure = input.unitOfMeasure;
    if (input.unitOfMeasureIsCustom !== undefined) inventoryFields.unit_of_measure_is_custom = input.unitOfMeasureIsCustom;
    if (input.lowStockThreshold !== undefined) inventoryFields.low_stock_threshold = input.lowStockThreshold;
    if (input.sku !== undefined) inventoryFields.sku = input.sku;

    const { data, error } = await this.supabase
      .from("products")
      .update({
        name: input.name,
        description: input.description ?? null,
        expected_price: input.expectedPrice ?? null,
        show_expected_price: input.showExpectedPrice ?? true,
        show_name_in_photo_view: input.showNameInPhotoView ?? true,
        ...inventoryFields,
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

  async getById(tenantId: string, productId: string): Promise<Product | null> {
    const { data, error } = await this.supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("tenant_id", tenantId)
      .eq("id", productId)
      .maybeSingle();

    if (error) {
      throw new Error(`ProductService.getById: ${error.message}`);
    }

    return data ? toProduct(data) : null;
  }

  /** Ordered `is_system` last (spec: "Others" always appears after every
   * configured product on Record Sale), then by display_order within
   * each group. */
  async listActive(tenantId: string): Promise<Product[]> {
    const { data, error } = await this.supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("is_system", { ascending: true })
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
      .order("is_system", { ascending: true })
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
    await this.assertNotSystem(tenantId, productId);

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
    await this.assertNotSystem(tenantId, productId);

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
    await this.assertNotSystem(tenantId, productId);

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
    await this.assertNotSystem(tenantId, productId);
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
    await this.assertNotSystem(tenantId, productId);
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
  is_system: boolean;
  tracks_inventory: boolean;
  unit_of_measure: string | null;
  unit_of_measure_is_custom: boolean;
  low_stock_threshold: number | null;
  sku: string | null;
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
    sku: row.sku,
    isSystem: row.is_system,
    tracksInventory: row.tracks_inventory,
    unitOfMeasure: row.unit_of_measure,
    unitOfMeasureIsCustom: row.unit_of_measure_is_custom,
    lowStockThreshold: row.low_stock_threshold,
  };
}

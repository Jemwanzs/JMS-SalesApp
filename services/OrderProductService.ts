import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export interface OrderableProduct {
  productId: string;
  name: string;
  imageUrl: string | null;
  isAvailable: boolean;
  minimumOrderAmount: number;
}

/**
 * Order Products is now a thin CONFIG layer over `products` (Sales/
 * Inventory's own catalogue) -- no separate name/description/image
 * entry, no duplicate catalogue. `listOrderableProducts` does the join
 * itself in application code (fetch products, fetch config, merge by
 * product_id) rather than a PostgREST embedded-resource select -- same
 * "fetch raw rows, join in JS" convention this codebase already
 * established for profile-name resolution (OrderService.getOrderDetail),
 * which also sidesteps `products`' multiple other FK relationships
 * (product_images etc.) ever causing a PostgREST relationship-ambiguity
 * error.
 *
 * A product with no `order_products` row yet reads as
 * `{isAvailable: true, minimumOrderAmount: 0}` -- this IS the "all
 * active products available by default" behavior (spec section 2),
 * done lazily at read time instead of a write-time backfill trigger,
 * so a product created after Orders was already enabled shows up
 * correctly with no extra step. minimum_order_amount = 0 is also the
 * "not yet configured" signal the storefront/empty-state logic reads
 * (PublicOrderingService.getStorefront, orders/products/page.tsx).
 */
export class OrderProductService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listOrderableProducts(tenantId: string): Promise<OrderableProduct[]> {
    const [{ data: products, error: productsError }, { data: configs, error: configsError }] = await Promise.all([
      this.supabase
        .from("products")
        .select("id, name, image_url, display_order")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .eq("is_system", false)
        .order("display_order", { ascending: true })
        .order("name", { ascending: true }),
      this.supabase.from("order_products").select("product_id, is_available, minimum_order_amount").eq("tenant_id", tenantId),
    ]);

    if (productsError) {
      throw new Error(`OrderProductService.listOrderableProducts: ${productsError.message}`);
    }
    if (configsError) {
      throw new Error(`OrderProductService.listOrderableProducts: ${configsError.message}`);
    }

    const configByProductId = new Map((configs ?? []).map((c) => [c.product_id, c]));

    return (products ?? []).map((p) => {
      const config = configByProductId.get(p.id);
      return {
        productId: p.id,
        name: p.name,
        imageUrl: p.image_url,
        isAvailable: config?.is_available ?? true,
        minimumOrderAmount: config ? Number(config.minimum_order_amount) : 0,
      };
    });
  }

  async setAvailability(tenantId: string, productId: string, isAvailable: boolean): Promise<void> {
    const { error } = await this.supabase
      .from("order_products")
      .upsert({ tenant_id: tenantId, product_id: productId, is_available: isAvailable }, { onConflict: "tenant_id,product_id" });

    if (error) {
      throw new Error(`OrderProductService.setAvailability: ${error.message}`);
    }
  }

  /** Backs Select All / Deselect All -- one multi-row upsert instead of N individual calls. */
  async bulkSetAvailability(tenantId: string, productIds: string[], isAvailable: boolean): Promise<void> {
    if (productIds.length === 0) return;

    const { error } = await this.supabase
      .from("order_products")
      .upsert(
        productIds.map((productId) => ({ tenant_id: tenantId, product_id: productId, is_available: isAvailable })),
        { onConflict: "tenant_id,product_id" }
      );

    if (error) {
      throw new Error(`OrderProductService.bulkSetAvailability: ${error.message}`);
    }
  }

  /** Backs the batch "Save Changes" button for minimum order amounts. */
  async saveMinimumOrderAmounts(tenantId: string, entries: { productId: string; minimumOrderAmount: number }[]): Promise<void> {
    if (entries.length === 0) return;

    const { error } = await this.supabase
      .from("order_products")
      .upsert(
        entries.map((e) => ({ tenant_id: tenantId, product_id: e.productId, minimum_order_amount: e.minimumOrderAmount })),
        { onConflict: "tenant_id,product_id" }
      );

    if (error) {
      throw new Error(`OrderProductService.saveMinimumOrderAmounts: ${error.message}`);
    }
  }
}

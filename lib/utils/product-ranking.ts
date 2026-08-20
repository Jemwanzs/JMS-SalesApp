import type { Product } from "@/services/ProductService";

export type ProductTier = "gold" | "silver" | "bronze";

const TIER_ORDER: ProductTier[] = ["gold", "silver", "bronze"];

/**
 * Sorts products by trailing-window revenue (highest first) and assigns
 * the top 3 with revenue > 0 a Gold/Silver/Bronze tier -- a product with
 * no sales in the window never gets a tier, even if fewer than 3
 * products have any revenue at all. Only called when a tenant has
 * product_ranking_enabled on; otherwise the sales page passes products
 * through in their existing display_order (ProductService.listActive's
 * default sort), which doubles as this feature's "preferred ordering"
 * fallback -- see features/products/components/product-management-list.tsx's
 * Move Up/Down UI (Phase 2k), reused rather than rebuilt.
 */
export function rankProducts(
  products: Product[],
  revenueTotals: Map<string, number>
): (Product & { tier: ProductTier | null; thirtyDayRevenue: number })[] {
  return [...products]
    .map((product) => ({
      ...product,
      thirtyDayRevenue: revenueTotals.get(product.id) ?? 0,
    }))
    .sort((a, b) => b.thirtyDayRevenue - a.thirtyDayRevenue)
    .map((product, index) => ({
      ...product,
      tier: product.thirtyDayRevenue > 0 ? (TIER_ORDER[index] ?? null) : null,
    }));
}

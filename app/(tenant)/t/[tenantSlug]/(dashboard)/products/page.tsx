import type { Metadata } from "next";

import { archiveProductAction } from "@/features/products/actions/archive-product";
import { AddProductForm } from "@/features/products/components/add-product-form";
import { ProductService } from "@/services/ProductService";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Products | JMS Sales App",
};

/**
 * Phase 2a: manual product creation + archive. No bulk upload, no
 * Storage-backed image upload widget, no drag-and-drop reordering yet
 * (docs/10-products.md notes these as deliberate scope cuts) — this is
 * what unblocks Sales Capture from being real.
 */
export default async function ProductsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .single();

  const productService = new ProductService(supabase);
  const products = await productService.listActive(tenant!.id);

  async function archive(productId: string) {
    "use server";
    await archiveProductAction(tenant!.id, tenantSlug, productId);
  }

  return (
    <div className="flex flex-1 flex-col p-6">
      <h1 className="mb-4 text-xl font-semibold">Products</h1>

      <AddProductForm tenantId={tenant!.id} tenantSlug={tenantSlug} />

      <div className="mt-6 space-y-2">
        {products.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No products yet. Add your first one above.
          </p>
        )}
        {products.map((product) => (
          <div
            key={product.id}
            className="flex items-center justify-between rounded-lg border p-3"
          >
            <div>
              <p className="text-sm font-medium">{product.name}</p>
              {product.expectedPrice !== null && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {product.expectedPrice.toFixed(2)}
                </p>
              )}
            </div>
            <form action={archive.bind(null, product.id)}>
              <Button type="submit" variant="ghost" size="sm">
                Archive
              </Button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}

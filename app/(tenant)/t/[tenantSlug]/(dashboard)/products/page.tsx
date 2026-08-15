import type { Metadata } from "next";

import { AddProductForm } from "@/features/products/components/add-product-form";
import { ProductManagementList } from "@/features/products/components/product-management-list";
import { ProductService } from "@/services/ProductService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Products | JMS Sales App",
};

/**
 * Phase 2a (creation) + the product-enhancements batch (edit, image
 * upload/replace/remove, activate/deactivate). listAll() shows active +
 * inactive so admins can toggle a product back on; archived products are
 * deliberately excluded here too (soft-deleted, no longer catalog-
 * managed) and were never shown on this page even before this batch.
 * No bulk upload or drag-and-drop reordering yet (docs/10-products.md
 * notes these as deliberate scope cuts).
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

  const tenantId = tenant!.id;

  const [products, canEdit, canArchive] = await Promise.all([
    new ProductService(supabase).listAll(tenantId),
    can("products.edit", { tenantId }),
    can("products.archive", { tenantId }),
  ]);

  return (
    <div className="flex flex-1 flex-col p-6">
      <h1 className="mb-4 text-xl font-semibold">Products</h1>

      <AddProductForm tenantId={tenantId} tenantSlug={tenantSlug} />

      <ProductManagementList
        products={products}
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        canEdit={canEdit}
        canArchive={canArchive}
      />
    </div>
  );
}

import type { Metadata } from "next";
import { BackLink } from "@/components/shared/back-link";

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
 * Bulk upload is Phase 5b (Imports); reordering is Move Up/Down buttons
 * on ProductManagementList, not drag-and-drop -- see that component's
 * own header comment for why.
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
      <BackLink href={`/t/${tenantSlug}/more`} label="More" />
      <h1 className="mb-4 text-xl font-semibold">Products</h1>

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

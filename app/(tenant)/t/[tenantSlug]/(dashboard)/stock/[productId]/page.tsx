import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { BackLink } from "@/components/shared/back-link";
import { ProductPhotoThumbnail } from "@/features/products/components/product-photo-viewer";
import { StockProductDetail } from "@/features/stock/components/stock-product-detail";
import { ProductService } from "@/services/ProductService";
import { StockService } from "@/services/StockService";
import { assertInventoryEnabled } from "@/lib/inventory/entitlement";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

export const metadata: Metadata = {
  title: "Stock | JMS Sales App",
};

export default async function StockProductDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; productId: string }>;
}) {
  const { tenantSlug, productId } = await params;
  const supabase = await createClient();

  const tenant = await getTenantBySlug(supabase, tenantSlug);
  const tenantId = tenant!.id;

  const canView = await can("inventory.view", { tenantId });
  if (!canView) {
    redirect(`/t/${tenantSlug}/more`);
  }

  try {
    await assertInventoryEnabled(tenantId);
  } catch {
    redirect(`/t/${tenantSlug}/more`);
  }

  const productService = new ProductService(supabase);
  const stockService = new StockService(supabase);

  const [product, canRecord] = await Promise.all([
    productService.getById(tenantId, productId),
    can("stock.movement.record", { tenantId }),
  ]);

  if (!product || !product.tracksInventory) {
    notFound();
  }

  const [balance, movements] = await Promise.all([
    stockService.getBalance(tenantId, productId),
    stockService.listMovementHistory(tenantId, productId),
  ]);

  return (
    <div className="flex flex-1 flex-col p-6">
      <BackLink href={`/t/${tenantSlug}/stock`} label="Stock" />
      <div className="mb-4 flex items-center gap-3">
        <ProductPhotoThumbnail imageUrl={product.imageUrl} productName={product.name} showName={false} className="h-14 w-14 border" />
        <h1 className="text-xl font-semibold">{product.name}</h1>
      </div>

      <StockProductDetail
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        productId={productId}
        productName={product.name}
        unitOfMeasure={product.unitOfMeasure}
        balance={balance}
        movements={movements}
        canRecord={canRecord}
      />
    </div>
  );
}

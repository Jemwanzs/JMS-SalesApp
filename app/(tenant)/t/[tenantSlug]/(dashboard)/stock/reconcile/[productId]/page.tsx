import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { BackLink } from "@/components/shared/back-link";
import { ReconciliationForm } from "@/features/stock/components/reconciliation-form";
import { ProductService } from "@/services/ProductService";
import { StockService } from "@/services/StockService";
import { assertInventoryEnabled } from "@/lib/inventory/entitlement";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { todayString } from "@/lib/utils/date-ranges";

export const metadata: Metadata = {
  title: "Reconcile Stock | JMS Sales App",
};

export default async function ReconcileProductPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; productId: string }>;
}) {
  const { tenantSlug, productId } = await params;
  const supabase = await createClient();

  const { data: tenant } = await supabase.from("tenants").select("id, timezone").eq("slug", tenantSlug).single();
  const tenantId = tenant!.id;

  const canReconcile = await can("stock.reconcile", { tenantId });
  if (!canReconcile) {
    redirect(`/t/${tenantSlug}/stock`);
  }

  try {
    await assertInventoryEnabled(tenantId);
  } catch {
    redirect(`/t/${tenantSlug}/more`);
  }

  const product = await new ProductService(supabase).getById(tenantId, productId);
  if (!product || !product.tracksInventory) {
    notFound();
  }

  const today = todayString(tenant!.timezone);
  const preview = await new StockService(supabase).getReconciliationPreview(tenantId, productId, today);

  return (
    <div className="flex flex-1 flex-col p-6">
      <BackLink href={`/t/${tenantSlug}/stock/reconcile`} label="Reconcile" />
      <h1 className="mb-4 text-xl font-semibold">{product.name}</h1>

      <ReconciliationForm
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        productId={productId}
        productName={product.name}
        unitOfMeasure={product.unitOfMeasure}
        date={today}
        preview={preview}
      />
    </div>
  );
}

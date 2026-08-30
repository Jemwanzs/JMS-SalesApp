import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BackLink } from "@/components/shared/back-link";
import { ProductPhotoThumbnail } from "@/features/products/components/product-photo-viewer";
import { StockService } from "@/services/StockService";
import { assertInventoryEnabled } from "@/lib/inventory/entitlement";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";
import { todayString } from "@/lib/utils/date-ranges";

export const metadata: Metadata = {
  title: "Reconcile Stock | JMS Sales App",
};

/**
 * Today's reconciliation queue (Product Enhancements #4) -- every
 * tracked product with no stock_reconciliations row yet for today,
 * per the tenant's own timezone (todayString, same helper Analytics/
 * business-day already use for "today," never raw UTC).
 */
export default async function StockReconcilePage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const tenant = await getTenantBySlug(supabase, tenantSlug);
  const tenantId = tenant!.id;

  const canReconcile = await can("stock.reconcile", { tenantId });
  if (!canReconcile) {
    redirect(`/t/${tenantSlug}/stock`);
  }

  try {
    await assertInventoryEnabled(tenantId, "write");
  } catch {
    redirect(`/t/${tenantSlug}/more`);
  }

  const today = todayString(tenant!.timezone);
  const pending = await new StockService(supabase).listPendingReconciliation(tenantId, today);

  return (
    <div className="flex flex-1 flex-col p-6">
      <BackLink href={`/t/${tenantSlug}/stock`} label="Stock" />
      <h1 className="mb-1 text-xl font-semibold">Reconcile stock</h1>
      <p className="mb-4 text-sm text-muted-foreground">Today&apos;s physical count</p>

      {pending.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">Every tracked product has been counted today.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {pending.map((row) => (
            <Link
              key={row.productId}
              href={`/t/${tenantSlug}/stock/reconcile/${row.productId}`}
              className="flex items-center gap-3 p-3 hover:bg-muted/50"
            >
              <ProductPhotoThumbnail imageUrl={row.imageUrl} productName={row.productName} showName={false} className="h-14 w-14 border" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.productName}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  System balance: {row.balance} {row.unitOfMeasure ?? "units"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

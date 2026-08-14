import type { Metadata } from "next";

import { OpenBusinessDayButton } from "@/features/sales/components/open-business-day-button";
import { ProductGrid } from "@/features/sales/components/product-grid";
import { SalesVisibilityBadge } from "@/features/sales/components/sales-visibility-badge";
import { BusinessDayService } from "@/services/BusinessDayService";
import { ProductService } from "@/services/ProductService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Sales | JMS Sales App",
};

/**
 * Capture Sales is the golden-path landing screen (spec S13). Phase 2b/
 * 2d make this real: a business day must be open before any sale can be
 * recorded (docs/09-business-day-engine.md), and the product grid +
 * record-sale sheet are the actual capture flow, not a placeholder.
 */
export default async function SalesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle()
    : { data: null };

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .single();

  const { data: locationRow } = await supabase
    .from("locations")
    .select("id")
    .eq("tenant_id", tenant!.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  const location = locationRow!;

  const businessDayService = new BusinessDayService(supabase);
  const businessDay = await businessDayService.getTodayBusinessDay(tenant!.id, location.id);

  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const canOpenDay = await can("business_day.open", { tenantId: tenant!.id });

  return (
    <div className="flex flex-1 flex-col p-6">
      <p className="text-sm text-muted-foreground">{today}</p>
      <h1 className="mt-1 text-xl font-semibold">Good day, {firstName}</h1>

      <div className="mt-6">
        <SalesVisibilityBadge />
      </div>

      {businessDay?.status === "open" ? (
        <SalesCaptureBody
          tenantId={tenant!.id}
          tenantSlug={tenantSlug}
          locationId={location.id}
          businessDayId={businessDay.id}
          supabase={supabase}
        />
      ) : (
        <div className="mt-8 flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
          <p className="text-lg font-medium">Business day not open</p>
          <p className="mt-2 max-w-[28ch] text-sm text-muted-foreground">
            {canOpenDay
              ? "Open the business day to start recording sales."
              : "Ask an administrator to open today's business day."}
          </p>
          {canOpenDay && (
            <div className="mt-4 w-full max-w-[240px]">
              <OpenBusinessDayButton
                tenantId={tenant!.id}
                tenantSlug={tenantSlug}
                locationId={location.id}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

async function SalesCaptureBody({
  tenantId,
  tenantSlug,
  locationId,
  businessDayId,
  supabase,
}: {
  tenantId: string;
  tenantSlug: string;
  locationId: string;
  businessDayId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const productService = new ProductService(supabase);
  const products = await productService.listActive(tenantId);

  return (
    <div className="-mx-6 mt-4 flex flex-1 flex-col">
      <ProductGrid
        products={products}
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        locationId={locationId}
        businessDayId={businessDayId}
      />
    </div>
  );
}

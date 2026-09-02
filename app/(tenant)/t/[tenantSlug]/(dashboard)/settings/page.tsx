import type { Metadata } from "next";
import { BackLink } from "@/components/shared/back-link";
import { redirect } from "next/navigation";

import { AnniversaryWishCard } from "@/features/settings/components/anniversary-wish-card";
import { BranchesCard } from "@/features/settings/components/branches-card";
import { ExpensesModuleCard } from "@/features/settings/components/expenses-module-card";
import { InventoryModuleCard } from "@/features/settings/components/inventory-module-card";
import { NotesFieldCard } from "@/features/settings/components/notes-field-card";
import { ProductRankingCard } from "@/features/settings/components/product-ranking-card";
import { QuantityFieldCard } from "@/features/settings/components/quantity-field-card";
import { SaleNumberTemplateCard } from "@/features/settings/components/sale-number-template-card";
import { AnniversaryService } from "@/services/AnniversaryService";
import { BillingService } from "@/services/BillingService";
import { LocationService } from "@/services/LocationService";
import { TenantService } from "@/services/TenantService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

const DEFAULT_SALE_NUMBER_TEMPLATE = "SALE-{YYYY}-{000001}";

export const metadata: Metadata = {
  title: "Settings | JMS Sales App",
};

/**
 * Business-wide settings, `settings.manage`-gated. This directory
 * existed as an unused placeholder since the More menu's own "Settings"
 * entry was scaffolded (spec S12) with no page ever built behind it;
 * Phase 7d's anniversary wish-mode toggle was the first real setting to
 * land here, and the sale-number template (docs/08-sales-engine.md,
 * deferred since migration 0005) is the second. Other tenant-wide
 * settings can land on this same page over time rather than each
 * inventing its own screen.
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const tenant = await getTenantBySlug(supabase, tenantSlug);
  const tenantId = tenant!.id;

  if (!(await can("settings.manage", { tenantId }))) {
    redirect(`/t/${tenantSlug}/more`);
  }

  const tenantService = new TenantService(supabase);
  // Service-role, not the RLS-respecting client -- platform_settings has
  // zero RLS policies for anyone (same posture as platform_admins), so
  // getAddonTrialDaysConfigured needs it regardless of the viewer's own
  // permissions; reused for the other two addon reads here too rather
  // than mixing clients.
  const addonBillingService = new BillingService(createServiceRoleClient());
  const [
    currentMode,
    saleNumberTemplate,
    primaryLocation,
    locations,
    productRankingEnabled,
    showDailySalesVolume,
    showProductPrice,
    quantityEnabled,
    notesFieldEnabled,
    expensesEnabled,
    inventoryEnabledSetting,
    inventoryAddon,
    inventoryPlans,
    inventoryTrialDays,
  ] = await Promise.all([
    new AnniversaryService(supabase).getWishMode(tenantId),
    tenantService.getSetting<string>(tenantId, "sale_number_template"),
    supabase.from("locations").select("code").eq("tenant_id", tenantId).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    new LocationService(supabase).listLocations(tenantId),
    tenantService.getSetting<boolean>(tenantId, "product_ranking_enabled"),
    tenantService.getSetting<boolean>(tenantId, "show_daily_sales_volume"),
    tenantService.getSetting<boolean>(tenantId, "show_product_price_on_landing"),
    tenantService.getSetting<boolean>(tenantId, "quantity_enabled"),
    tenantService.getSetting<boolean>(tenantId, "notes_field_enabled"),
    tenantService.getSetting<boolean>(tenantId, "expenses_enabled"),
    tenantService.getSetting<boolean>(tenantId, "inventory_enabled"),
    addonBillingService.getAddonSubscription(tenantId, "inventory"),
    addonBillingService.listAddonPlans("inventory"),
    addonBillingService.getAddonTrialDaysConfigured(tenantId, "inventory"),
  ]);

  // Matches features/settings/actions/set-inventory-enabled.ts's own
  // ENTITLED_WITHOUT_CHECKOUT exactly (deliberately narrower than
  // lib/inventory/entitlement.ts's nav-display tolerance) -- this
  // confirmation copy must never promise "nothing to pay" for a status
  // that the action itself would actually route to checkout.
  const ENTITLED_WITHOUT_CHECKOUT = new Set(["TRIAL", "ACTIVE"]);
  const entitledWithoutCheckout = inventoryAddon != null && ENTITLED_WITHOUT_CHECKOUT.has(inventoryAddon.status);
  // Mirrors BillingService.bootstrapAddonTrial's own eligibility check:
  // no row yet, or an abandoned checkout placeholder that never actually
  // started a trial or reached a real paid period, is still trial-
  // eligible regardless of its current status -- otherwise a tenant who
  // backed out of an unpaid checkout would be shown "Subscribe" forever
  // instead of the trial they never actually used.
  const trialEligible = !inventoryAddon || (inventoryAddon.trialEnd === null && inventoryAddon.currentPeriodEnd === null);
  const inventoryConfirmMode: "reenable" | "trial" | "checkout" = entitledWithoutCheckout
    ? "reenable"
    : trialEligible && inventoryTrialDays > 0
      ? "trial"
      : "checkout";

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <BackLink href={`/t/${tenantSlug}/more`} label="More" />
      <h1 className="text-xl font-semibold">Settings</h1>
      <BranchesCard tenantId={tenantId} tenantSlug={tenantSlug} initialLocations={locations} />
      <SaleNumberTemplateCard
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        initialTemplate={saleNumberTemplate ?? DEFAULT_SALE_NUMBER_TEMPLATE}
        sampleLocationCode={primaryLocation.data?.code ?? null}
      />
      <AnniversaryWishCard tenantId={tenantId} tenantSlug={tenantSlug} anniversaryDate={tenant!.anniversary_date} currentMode={currentMode} />
      <ProductRankingCard
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        initialRankingEnabled={productRankingEnabled ?? true}
        initialShowDailyVolume={showDailySalesVolume ?? false}
        initialShowProductPrice={showProductPrice ?? true}
      />
      <QuantityFieldCard tenantId={tenantId} tenantSlug={tenantSlug} initialEnabled={quantityEnabled ?? true} />
      <NotesFieldCard tenantId={tenantId} tenantSlug={tenantSlug} initialEnabled={notesFieldEnabled ?? true} />
      <ExpensesModuleCard tenantId={tenantId} tenantSlug={tenantSlug} initialEnabled={expensesEnabled ?? false} />
      {inventoryPlans.length > 0 && (
        <InventoryModuleCard
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          initialEnabled={Boolean(inventoryEnabledSetting)}
          plans={inventoryPlans}
          trialDaysAvailable={inventoryTrialDays}
          confirmMode={inventoryConfirmMode}
        />
      )}
    </div>
  );
}

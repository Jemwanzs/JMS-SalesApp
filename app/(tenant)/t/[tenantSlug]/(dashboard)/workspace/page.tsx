import type { Metadata } from "next";
import { BackLink } from "@/components/shared/back-link";
import { redirect } from "next/navigation";

import { BrandingForm } from "@/features/workspace/components/branding-form";
import { BusinessHoursForm } from "@/features/workspace/components/business-hours-form";
import { BusinessProfileForm } from "@/features/workspace/components/business-profile-form";
import { TenantService } from "@/services/TenantService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";
import { CURRENCIES, TIMEZONES } from "@/validations/onboarding";

export const metadata: Metadata = {
  title: "Workspace | JMS Sales App",
};

const DEFAULT_HOURS = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  openTime: "08:00",
  closeTime: "17:00",
  closedAllDay: dayOfWeek === 0,
}));

/**
 * The business details captured once at sign-up/onboarding (name, type,
 * website, anniversary, currency, timezone, and the primary location's
 * name/address/working hours) had nowhere to be edited afterwards --
 * onboarding's own actions (features/onboarding/actions/) are one-way
 * writes with no read-back and no post-onboarding permission gate. This
 * page is that missing edit surface: same settings.manage gate as
 * Settings, reached from the top of More's "Team & business" section
 * rather than folded into Settings itself, since these are facts about
 * the business, not app-behavior toggles.
 */
export default async function WorkspacePage({
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
  const location = await tenantService.getPrimaryLocation(tenantId);
  const hours = location
    ? await tenantService.getLocationHours(tenantId, location.id)
    : DEFAULT_HOURS;

  // tenants.currency/timezone are plain text columns (no DB-level enum
  // constraint), while the edit form's fixed pickers only offer this
  // codebase's known list -- fall back to a sane default in the rare
  // case a tenant's stored value predates or falls outside that list,
  // rather than crashing the page.
  const currency = (CURRENCIES as readonly string[]).includes(tenant!.currency)
    ? (tenant!.currency as (typeof CURRENCIES)[number])
    : "KES";
  const timezone = (TIMEZONES as readonly string[]).includes(tenant!.timezone)
    ? (tenant!.timezone as (typeof TIMEZONES)[number])
    : "UTC";

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <BackLink href={`/t/${tenantSlug}/more`} label="More" />
      <h1 className="text-xl font-semibold">Workspace</h1>
      <p className="-mt-2 text-sm text-muted-foreground">
        The business details set up when this workspace was created.
      </p>

      <BrandingForm
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        initial={tenant!.logo_url && tenant!.logo_storage_path ? { url: tenant!.logo_url, storagePath: tenant!.logo_storage_path } : null}
      />

      <BusinessProfileForm
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        initial={{
          businessName: tenant!.name,
          businessType: tenant!.business_type ?? "",
          website: tenant!.website ?? "",
          anniversaryDate: tenant!.anniversary_date ?? "",
          currency,
          timezone,
        }}
      />

      <BusinessHoursForm
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        initial={{
          locationName: location?.name ?? "Head Office",
          address: location?.address ?? "",
          hours,
        }}
      />
    </div>
  );
}

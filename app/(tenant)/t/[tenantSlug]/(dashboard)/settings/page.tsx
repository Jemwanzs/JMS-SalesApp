import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AnniversaryWishCard } from "@/features/settings/components/anniversary-wish-card";
import { AnniversaryService } from "@/services/AnniversaryService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Settings | JMS Sales App",
};

/**
 * Business-wide settings, `settings.manage`-gated. Deliberately minimal
 * today -- this directory existed as an unused placeholder since the
 * More menu's own "Settings" entry was scaffolded (spec S12) with no
 * page ever built behind it; Phase 7d's anniversary wish-mode toggle
 * ("Automatic / Review Before Sending / Disabled", docs/15-super-
 * admin.md, "never forced on a tenant that hasn't opted in") is the
 * first real setting to need a home here. Other tenant-wide settings
 * can land on this same page over time rather than each inventing its
 * own screen.
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const { data: tenant } = await supabase.from("tenants").select("id, anniversary_date").eq("slug", tenantSlug).single();
  const tenantId = tenant!.id;

  if (!(await can("settings.manage", { tenantId }))) {
    redirect(`/t/${tenantSlug}/more`);
  }

  const currentMode = await new AnniversaryService(supabase).getWishMode(tenantId);

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <AnniversaryWishCard tenantId={tenantId} tenantSlug={tenantSlug} anniversaryDate={tenant!.anniversary_date} currentMode={currentMode} />
    </div>
  );
}

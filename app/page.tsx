import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant/resolve-active-tenant";

/**
 * The root route is never a destination in itself -- it routes signed-out
 * visitors to /login and signed-in users straight to their tenant's
 * landing page (docs/07-ui-ux-screen-map.md: "Capture Sales, NOT a
 * dashboard" -- the golden path is Login -> tenant, no intermediate stop
 * here), or into the onboarding wizard first if they haven't finished it.
 */
export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const tenant = await resolveActiveTenant(supabase, user.id);

  if (!tenant) {
    redirect("/no-tenant");
  }

  redirect(
    tenant.needsOnboarding
      ? `/t/${tenant.slug}/onboarding`
      : `/t/${tenant.slug}/sales`
  );
}

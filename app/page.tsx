import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenantSlug } from "@/lib/tenant/resolve-active-tenant";

/**
 * The root route is never a destination in itself -- it routes signed-out
 * visitors to /login and signed-in users straight to their tenant's
 * landing page (docs/07-ui-ux-screen-map.md: "Capture Sales, NOT a
 * dashboard" -- the golden path is Login -> tenant, no intermediate stop
 * here).
 */
export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const slug = await resolveActiveTenantSlug(supabase, user.id);

  redirect(slug ? `/t/${slug}` : "/no-tenant");
}

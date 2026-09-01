import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SelectBranchForm } from "@/features/auth/components/select-branch-form";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveActiveTenant } from "@/lib/tenant/resolve-active-tenant";
import { resolveUserBranches } from "@/lib/tenant/resolve-user-branches";

export const metadata: Metadata = {
  title: "Select branch | JMS Sales App",
};

/**
 * Multi-Branch User Access Phase 4. Normally only ever linked to by
 * signInAction when it already found 2+ assigned branches for this
 * user -- the re-resolution here is defense in depth against someone
 * navigating here directly (a bookmark, a back-button) rather than the
 * primary source of truth, same posture as selectBranchAction's own
 * server-side re-check.
 *
 * Phase 5 adds a second reason to land here: sales/page.tsx redirects
 * here whenever resolveActiveLocationId finds no active_branch_sessions
 * row for the current session (expected for anyone who authenticated
 * before Phase 4/5 shipped). For that self-healing path the
 * branches.length === 1 case below can no longer just redirect
 * straight into the tenant assuming sign-in already wrote the row --
 * it wouldn't have, which is exactly why we're here -- so it writes it
 * itself before continuing.
 */
export default async function SelectBranchPage({
  searchParams,
}: {
  searchParams: Promise<{ adminBypass?: string }>;
}) {
  const { adminBypass } = await searchParams;

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

  const bypassQuery = adminBypass ? `?adminBypass=${adminBypass}` : "";

  if (tenant.needsOnboarding) {
    redirect(`/t/${tenant.slug}/onboarding${bypassQuery}`);
  }

  const branches = await resolveUserBranches(supabase, tenant.tenantId, user.id);

  if (branches.length === 1) {
    const { data: claims } = await supabase.auth.getClaims();
    const sessionId = claims?.claims.session_id;
    if (sessionId) {
      await createServiceRoleClient()
        .from("active_branch_sessions")
        .upsert({ session_id: sessionId, profile_id: user.id, tenant_id: tenant.tenantId, location_id: branches[0].id });
    }
  }

  if (branches.length <= 1) {
    redirect(`/t/${tenant.slug}/sales${bypassQuery}`);
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Select a branch</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Choose which branch you&apos;re working from today. You&apos;ll need to log out and back in to switch later.
      </p>
      <SelectBranchForm branches={branches} adminBypass={adminBypass} />
    </div>
  );
}

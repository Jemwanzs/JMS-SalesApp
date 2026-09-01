"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveActiveTenant } from "@/lib/tenant/resolve-active-tenant";
import { resolveUserBranches } from "@/lib/tenant/resolve-user-branches";

export interface SelectBranchState {
  error?: string;
}

/**
 * Multi-Branch User Access Phase 4. The `locationId` a client submits
 * is never trusted outright -- re-resolved against
 * resolveUserBranches' own result for this exact user/tenant/session,
 * same "don't trust a client-submitted id, re-check server-side"
 * discipline as everywhere else permission-sensitive in this app.
 */
export async function selectBranchAction(
  _prevState: SelectBranchState,
  formData: FormData
): Promise<SelectBranchState> {
  const locationId = String(formData.get("locationId") ?? "");
  const bypassNotice = formData.get("adminBypass");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  const tenant = await resolveActiveTenant(supabase, user.id);
  if (!tenant) {
    redirect("/no-tenant");
  }

  const branches = await resolveUserBranches(supabase, tenant.tenantId, user.id);
  const chosen = branches.find((b) => b.id === locationId);
  if (!chosen) {
    return { error: "Choose one of your assigned branches" };
  }

  const { data: claims } = await supabase.auth.getClaims();
  const sessionId = claims?.claims.session_id;
  if (!sessionId) {
    return { error: "Could not confirm your session -- please log in again" };
  }

  const { error } = await createServiceRoleClient()
    .from("active_branch_sessions")
    .upsert({ session_id: sessionId, profile_id: user.id, tenant_id: tenant.tenantId, location_id: chosen.id });

  if (error) {
    return { error: "Could not select this branch -- try again" };
  }

  const bypassQuery = typeof bypassNotice === "string" && bypassNotice ? `?adminBypass=${bypassNotice}` : "";
  redirect(`/t/${tenant.slug}/sales${bypassQuery}`);
}

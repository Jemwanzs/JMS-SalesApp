import type { SupabaseClient } from "@supabase/supabase-js";

import { LocationService, type LocationSummary } from "@/services/LocationService";
import { can } from "@/lib/permissions/can";
import { resolveActiveLocationId } from "@/lib/tenant/resolve-active-location";
import type { Database } from "@/types/database.types";

export interface BranchScope {
  /** analytics.branch_performance -- whether the caller may pick a branch other than their own, or "All Branches". */
  canPickAnyBranch: boolean;
  /** Every active branch, for the picker's options. Empty for a caller without canPickAnyBranch -- they have nothing to pick from. */
  allBranches: LocationSummary[];
  /** null means "All Branches". Only ever non-null-or-null-by-choice for a canPickAnyBranch holder. */
  selectedLocationId: string | null;
  /**
   * The value every query in this module actually uses. Equals
   * selectedLocationId for a canPickAnyBranch holder; otherwise FORCED to
   * the caller's own current active branch regardless of what the URL
   * asked for -- this is the real enforcement point, not just a default.
   */
  effectiveLocationId: string | null;
}

/**
 * Branch Performance's single security enforcement point. A confined
 * (non-canPickAnyBranch) caller's requested branch is never even looked
 * at -- hand-crafting `?branch=<other-branch-id>` or `?branch=` (All
 * Branches) in the URL has zero effect, since effectiveLocationId is
 * unconditionally their own resolveActiveLocationId() result. Every
 * tab's service call receives ONLY effectiveLocationId, never the raw
 * search param, so there is no code path where a confined user's own
 * crafted request can reach another branch's data.
 */
export async function resolveBranchScope(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  requestedLocationId: string | null
): Promise<BranchScope> {
  const canPickAnyBranch = await can("analytics.branch_performance", { tenantId });

  if (!canPickAnyBranch) {
    const ownLocationId = await resolveActiveLocationId(supabase, tenantId);
    return {
      canPickAnyBranch: false,
      allBranches: [],
      selectedLocationId: ownLocationId,
      effectiveLocationId: ownLocationId,
    };
  }

  const allBranches = (await new LocationService(supabase).listLocations(tenantId)).filter((l) => l.status === "active");
  const selectedLocationId =
    requestedLocationId && allBranches.some((l) => l.id === requestedLocationId) ? requestedLocationId : null;

  return {
    canPickAnyBranch: true,
    allBranches,
    selectedLocationId,
    effectiveLocationId: selectedLocationId,
  };
}

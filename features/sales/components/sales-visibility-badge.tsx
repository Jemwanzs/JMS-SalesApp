"use client";

import { Badge } from "@/components/ui/badge";
import { usePermission } from "@/hooks/tenant-context";

/**
 * First real exercise of usePermission()/TenantProvider (Phase 1e) —
 * mirrors the spec's own permission split (sales.view_own vs
 * sales.view_all, see docs/06-roles-permissions.md S31-32). Placeholder
 * until the real Sales Capture screen (Phase 2d) replaces this page.
 */
export function SalesVisibilityBadge() {
  const canViewAll = usePermission("sales.view_all");

  return (
    <Badge variant={canViewAll ? "default" : "secondary"}>
      {canViewAll ? "Business-wide sales visibility" : "Own sales only"}
    </Badge>
  );
}

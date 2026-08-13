"use client";

import { createContext, useContext } from "react";

import type { ResolvedPermission } from "@/lib/permissions/can";

export interface TenantContextValue {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  /**
   * The signed-in user's resolved permission set for this tenant,
   * computed server-side (lib/permissions/can.ts's getMyPermissions,
   * called once in the tenant layout) and hydrated down here so client
   * components can gate UI without an extra round trip. Mirrors the
   * exact matching rule the SQL has_permission() function and the
   * server-side can() helper use — see docs/06-roles-permissions.md.
   */
  permissions: ResolvedPermission[];
}

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({
  value,
  children,
}: {
  value: TenantContextValue;
  children: React.ReactNode;
}) {
  return (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);

  if (!ctx) {
    throw new Error("useTenant must be used within a TenantProvider");
  }

  return ctx;
}

/**
 * Client-side permission check for gating UI (hide/disable a button the
 * user couldn't act on anyway). This is UX only — RLS and server-side
 * assertCan() are the enforced boundary regardless (defense in depth,
 * see docs/02-system-architecture.md), so a stale/bypassed client check
 * here is never a security hole, just a worse error message.
 */
export function usePermission(
  permissionKey: string,
  locationId: string | null = null
): boolean {
  const { permissions } = useTenant();

  return permissions.some(
    (p) =>
      p.permissionKey === permissionKey &&
      (p.locationId === null || locationId === null || p.locationId === locationId)
  );
}

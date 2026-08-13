import type { Metadata } from "next";

import { signOutAction } from "@/features/auth/actions/sign-out";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "No active business | JMS Sales App",
};

/**
 * Reached when a signed-in user has no active tenant_memberships row —
 * unreachable in the current implementation (every sign-up gets a tenant
 * immediately, see TenantService.createTenant), but a real destination
 * rather than a broken redirect target once invitations (Phase 4b) let a
 * membership exist in 'invited' or 'disabled' status.
 */
export default function NoTenantPage() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center px-6 text-center">
      <div className="w-full max-w-[430px]">
        <h1 className="text-xl font-semibold">No active business found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account isn&apos;t an active member of any business yet. If
          you were expecting an invitation, check with your business
          administrator.
        </p>
        <form action={signOutAction} className="mt-6">
          <Button type="submit" variant="outline">
            Log out
          </Button>
        </form>
      </div>
    </div>
  );
}

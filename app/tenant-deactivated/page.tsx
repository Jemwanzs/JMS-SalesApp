import type { Metadata } from "next";

import { signOutAction } from "@/features/auth/actions/sign-out";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Business deactivated | JMS Sales App",
};

/**
 * Reached when app/(tenant)/t/[tenantSlug]/layout.tsx finds a genuine
 * (non-impersonating) member of a tenant whose status is 'deactivated'
 * -- a UX fast-path mirroring app/no-tenant/page.tsx's exact shape. The
 * real enforcement is migration 0031's has_permission() redefinition,
 * not this page; this only exists so a deactivated tenant's member sees
 * a clear explanation instead of a page full of RLS-blocked empty data.
 */
export default function TenantDeactivatedPage() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center px-6 text-center">
      <div className="w-full max-w-[430px]">
        <h1 className="text-xl font-semibold">This business has been deactivated</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Access to this workspace has been suspended by the platform.
          Contact support if you believe this is a mistake.
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

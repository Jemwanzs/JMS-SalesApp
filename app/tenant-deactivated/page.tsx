import type { Metadata } from "next";

import { signOutAction } from "@/features/auth/actions/sign-out";
import { CancelTenantDeletionButton } from "@/features/settings/components/cancel-tenant-deletion-button";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";

export const metadata: Metadata = {
  title: "Business deactivated | JMS Sales App",
};

const GRACE_PERIOD_DAYS = 30;

/**
 * Reached when app/(tenant)/t/[tenantSlug]/layout.tsx finds a genuine
 * (non-impersonating) member of a tenant whose status is 'deactivated'
 * -- a UX fast-path mirroring app/no-tenant/page.tsx's exact shape. The
 * real enforcement is migration 0031's has_permission() redefinition,
 * not this page.
 *
 * Account Deletion (Feature 1): now distinguishes a self-service
 * deletion request (tenants.deletion_requested_at set, migration 0063)
 * from every other reason a platform admin might deactivate a tenant --
 * showing the scheduled purge date and, only for the person who
 * actually requested it, a Cancel button. Resolves "which tenant"
 * through the caller's own tenant_memberships row rather than a URL
 * param: migration 0049's `unique (profile_id)` constraint guarantees
 * there is never more than one to disambiguate, and tenants_select/
 * tenant_memberships_select RLS both work regardless of tenant status
 * (neither policy checks it), so this reads safely through the ordinary
 * RLS-respecting client -- no service-role needed for a read.
 */
export default async function TenantDeactivatedPage() {
  const supabase = await createClient();
  const user = await getCurrentUser();

  const membership = user
    ? await supabase.from("tenant_memberships").select("tenant_id").eq("profile_id", user.id).maybeSingle()
    : null;

  const tenant = membership?.data
    ? await supabase
        .from("tenants")
        .select("id, slug, name, deletion_requested_at, deletion_requested_by")
        .eq("id", membership.data.tenant_id)
        .maybeSingle()
    : null;

  const pendingDeletion = tenant?.data?.deletion_requested_at ? tenant.data : null;
  const isRequester = pendingDeletion && user && pendingDeletion.deletion_requested_by === user.id;
  const purgeDate = pendingDeletion
    ? new Date(new Date(pendingDeletion.deletion_requested_at!).getTime() + GRACE_PERIOD_DAYS * 86_400_000)
    : null;

  return (
    <div className="flex min-h-screen w-full items-center justify-center px-6 text-center">
      <div className="w-full max-w-[430px]">
        {pendingDeletion ? (
          <>
            <h1 className="text-xl font-semibold">{pendingDeletion.name} is scheduled for deletion</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This business will be permanently deleted on{" "}
              <strong>
                {purgeDate!.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
              </strong>
              . Every member, including you, has lost access in the meantime.
            </p>
            {isRequester ? (
              <p className="mt-2 text-sm text-muted-foreground">You can cancel this request until then.</p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Only the person who requested this can cancel it. Contact your Tenant Administrator.
              </p>
            )}
            <div className="mt-6 flex flex-col items-center gap-3">
              {isRequester && <CancelTenantDeletionButton tenantId={pendingDeletion.id} tenantSlug={pendingDeletion.slug} />}
              <form action={signOutAction}>
                <Button type="submit" variant="outline">
                  Log out
                </Button>
              </form>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">This business has been deactivated</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Access to this workspace has been suspended by the platform. Contact support if you believe this is a
              mistake.
            </p>
            <form action={signOutAction} className="mt-6">
              <Button type="submit" variant="outline">
                Log out
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

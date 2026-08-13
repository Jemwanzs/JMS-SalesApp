import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/features/auth/actions/sign-out";
import { Button } from "@/components/ui/button";

/**
 * Temporary placeholder landing page. Real Capture Sales screen is
 * Phase 2d; this exists so Phase 1c's sign-up -> tenant -> login loop is
 * verifiable end-to-end without pretending the onboarding wizard (Phase
 * 1d) or sales engine (Phase 2) are built yet — see
 * docs/20-development-progress.md.
 */
export default async function TenantHomePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("slug", tenantSlug)
    .maybeSingle();

  return (
    <div className="flex flex-1 flex-col p-6">
      <h1 className="text-xl font-semibold">Welcome to {tenant?.name}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your account and business are set up. Sales capture, products, and
        the rest of the onboarding wizard land in the next development
        phases.
      </p>
      <form action={signOutAction} className="mt-6">
        <Button type="submit" variant="outline">
          Log out
        </Button>
      </form>
    </div>
  );
}

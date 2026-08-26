import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OnboardingWizard } from "@/features/onboarding/components/onboarding-wizard";
import { createClient } from "@/lib/supabase/server";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

export const metadata: Metadata = {
  title: "Set up your business | JMS Sales App",
};

/**
 * First-Time Business Setup Wizard (spec S10), reached right after
 * sign-up (see features/auth/actions/sign-up.ts) or on first login
 * before any location exists (see lib/tenant/resolve-active-tenant.ts's
 * sibling check in the sign-in/root-page redirects). Sits outside the
 * (dashboard) route group deliberately -- no bottom nav during setup.
 */
export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const tenant = await getTenantBySlug(supabase, tenantSlug);

  if (!tenant) {
    notFound();
  }

  return (
    <OnboardingWizard
      tenantId={tenant.id}
      tenantSlug={tenant.slug}
      tenantName={tenant.name}
    />
  );
}

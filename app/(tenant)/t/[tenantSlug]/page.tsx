import { redirect } from "next/navigation";

/**
 * The golden path (spec S13): "the user's first destination after login
 * shall be Capture Sales, NOT a dashboard." /t/[slug] itself is never a
 * destination -- it always forwards straight into the Sales tab.
 */
export default async function TenantRootPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  redirect(`/t/${tenantSlug}/sales`);
}

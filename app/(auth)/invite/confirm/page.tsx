import type { Metadata } from "next";
import Link from "next/link";

import { AcceptInviteForm } from "@/features/auth/components/accept-invite-form";
import { UserService } from "@/services/UserService";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const metadata: Metadata = {
  title: "Complete your account | JMS Sales App",
};

/**
 * Landing page after an invited user clicks their invite email link
 * (features/users/actions/invite-user.ts sets redirectTo to
 * /api/auth/callback?next=/invite/confirm, which exchanges the link for
 * a real session before redirecting here). Lives outside (tenant)/t/
 * [tenantSlug] on purpose -- that layout redirects anyone without an
 * ACTIVE membership to /no-tenant, and this user's membership is still
 * 'invited' until they complete this form.
 *
 * If no pending invite exists (link reused after acceptance, or never
 * was one), shows a plain "no longer valid" state rather than crashing
 * -- a reused link is an expected case, not an error condition.
 */
export default async function InviteConfirmPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div>
        <h1 className="mb-2 text-2xl font-semibold">Sign in required</h1>
        <p className="text-sm text-muted-foreground">
          Please open your invite link again, or{" "}
          <Link href="/login" className="underline">
            sign in
          </Link>
          .
        </p>
      </div>
    );
  }

  const invite = await new UserService(createServiceRoleClient()).getPendingInvite(user.id);

  if (!invite) {
    return (
      <div>
        <h1 className="mb-2 text-2xl font-semibold">This invite is no longer valid</h1>
        <p className="text-sm text-muted-foreground">
          It may have already been accepted. If you already have an account,{" "}
          <Link href="/login" className="underline">
            sign in
          </Link>
          .
        </p>
      </div>
    );
  }

  // profiles.full_name is already correctly populated by handle_new_auth_user
  // (migration 0001) from the invite's user_metadata -- same source every
  // other page in this app reads a display name from.
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Welcome to {invite.tenantName}</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Confirm your details and set a password to finish setting up your account.
      </p>
      <AcceptInviteForm
        membershipId={invite.membershipId}
        tenantId={invite.tenantId}
        tenantSlug={invite.tenantSlug}
        tenantName={invite.tenantName}
        roleName={invite.roleName}
        email={user.email ?? ""}
        initialFullName={profile?.full_name ?? ""}
      />
    </div>
  );
}

"use server";

import { cookies } from "next/headers";

import { SecurityService } from "@/services/SecurityService";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface SignOutOtherSessionsResult {
  error?: string;
  success?: boolean;
}

/**
 * Self-service only -- `auth.signOut({ scope: 'others' })` uses the
 * caller's own live session to revoke every OTHER live session for this
 * user, a real, safe, documented capability (unlike admin-driven
 * revocation of a specific other user's session, which this SDK's admin
 * API doesn't cleanly support -- see SecurityService's header comment).
 */
export async function signOutOtherSessionsAction(): Promise<SignOutOtherSessionsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) {
    return { error: error.message };
  }

  const cookieStore = await cookies();
  const currentSessionId = cookieStore.get("sid")?.value ?? null;

  await new SecurityService(createServiceRoleClient())
    .revokeOtherSessions(user.id, currentSessionId)
    .catch(() => {});

  return { success: true };
}

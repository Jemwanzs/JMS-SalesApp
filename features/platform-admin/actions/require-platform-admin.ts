import "server-only";

import { PlatformAdminService } from "@/services/PlatformAdminService";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Shared by every platform-admin server action. platform_admins/
 * platform_audit_logs have ZERO RLS policies (migrations 0004/0022) --
 * there is no database backstop the way tenant-scoped actions get from
 * RLS, so this check IS the real enforcement, not a UX nicety layered on
 * top of something RLS already guarantees. Runs on every call
 * regardless of whether the caller reached it through the admin shell's
 * own layout guard, since a server action is directly invokable.
 *
 * Returns platform_admins.id (what platform_audit_logs.platform_admin_id
 * references), not the caller's own profiles.id/auth.uid().
 */
export async function requirePlatformAdminId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not signed in");
  }

  const platformAdminService = new PlatformAdminService(createServiceRoleClient());
  const platformAdminId = await platformAdminService.getPlatformAdminId(user.id);

  if (!platformAdminId) {
    throw new Error("Not authorized");
  }

  return platformAdminId;
}

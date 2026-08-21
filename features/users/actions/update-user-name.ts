"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { UserService } from "@/services/UserService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function updateUserNameAction(
  tenantId: string,
  tenantSlug: string,
  targetProfileId: string,
  fullName: string
): Promise<void> {
  const trimmed = fullName.trim();
  if (!trimmed) {
    throw new Error("Enter a name");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not signed in");
  }

  await assertCan("users.edit", { tenantId });

  const { data: previous } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", targetProfileId)
    .maybeSingle();

  await new UserService(supabase).updateProfileName(targetProfileId, trimmed);

  await new AuditService(createServiceRoleClient())
    .log({
      tenantId,
      actorProfileId: user.id,
      action: AUDIT_ACTION.USER_NAME_CHANGED,
      entityType: "profile",
      entityId: targetProfileId,
      oldValues: { fullName: previous?.full_name ?? null },
      newValues: { fullName: trimmed },
    })
    .catch(() => {});

  revalidatePath(`/t/${tenantSlug}/users`);
}

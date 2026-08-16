"use server";

import { revalidatePath } from "next/cache";

import { UserService } from "@/services/UserService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export async function setUserRoleAction(
  tenantId: string,
  tenantSlug: string,
  membershipId: string,
  roleId: string
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not signed in");
  }

  const userService = new UserService(supabase);

  await assertCan("users.edit", { tenantId });
  await userService.setUserRole(tenantId, membershipId, roleId, user.id);

  revalidatePath(`/t/${tenantSlug}/users`);
}

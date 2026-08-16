"use server";

import { revalidatePath } from "next/cache";

import { UserService } from "@/services/UserService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export async function setUserActiveAction(
  tenantId: string,
  tenantSlug: string,
  membershipId: string,
  active: boolean
): Promise<void> {
  const supabase = await createClient();
  const userService = new UserService(supabase);

  await assertCan("users.edit", { tenantId });
  await userService.setActive(tenantId, membershipId, active);

  revalidatePath(`/t/${tenantSlug}/users`);
}

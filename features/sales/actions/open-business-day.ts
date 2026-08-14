"use server";

import { revalidatePath } from "next/cache";

import { BusinessDayService } from "@/services/BusinessDayService";
import { createClient } from "@/lib/supabase/server";

export async function openBusinessDayAction(
  tenantId: string,
  tenantSlug: string,
  locationId: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  const businessDayService = new BusinessDayService(supabase);

  try {
    await businessDayService.openDay(tenantId, locationId, user.id);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not open business day",
    };
  }

  revalidatePath(`/t/${tenantSlug}/sales`);
  return {};
}

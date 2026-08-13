"use server";

import { redirect } from "next/navigation";

import { AuthService } from "@/services/AuthService";
import { createClient } from "@/lib/supabase/server";

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  const authService = new AuthService(supabase);

  await authService.signOut();

  redirect("/login");
}

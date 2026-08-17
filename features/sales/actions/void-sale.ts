"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { SalesService } from "@/services/SalesService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { voidSaleSchema, type VoidSaleInput } from "@/validations/sale";
import type { VoidOrCorrectResult } from "@/types/database.types";

export interface VoidSaleState {
  error?: string;
  fieldErrors?: Partial<Record<keyof VoidSaleInput, string>>;
  result?: VoidOrCorrectResult;
}

export async function voidSaleAction(
  tenantSlug: string,
  _prevState: VoidSaleState,
  formData: FormData
): Promise<VoidSaleState> {
  const parsed = voidSaleSchema.safeParse({
    saleId: formData.get("saleId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof VoidSaleInput>(parsed.error.issues),
    };
  }

  const supabase = await createClient();
  const salesService = new SalesService(supabase);

  try {
    const result = await salesService.voidSale(parsed.data.saleId, parsed.data.reason);

    if (result.status === "voided") {
      const [{ data: user }, { data: sale }] = await Promise.all([
        supabase.auth.getUser().then((r) => ({ data: r.data.user })),
        supabase.from("sales").select("tenant_id").eq("id", parsed.data.saleId).single(),
      ]);
      await new AuditService(createServiceRoleClient())
        .log({
          tenantId: sale?.tenant_id ?? null,
          actorProfileId: user?.id ?? null,
          action: AUDIT_ACTION.SALE_VOIDED,
          entityType: "sale",
          entityId: parsed.data.saleId,
          reason: parsed.data.reason,
        })
        .catch(() => {});
    }

    revalidatePath(`/t/${tenantSlug}/sales-history`);
    return { result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not void sale" };
  }
}

"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { SalesService } from "@/services/SalesService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { deleteSaleSchema, type DeleteSaleInput } from "@/validations/sale";
import type { VoidOrCorrectResult } from "@/types/database.types";

export interface DeleteSaleState {
  error?: string;
  fieldErrors?: Partial<Record<keyof DeleteSaleInput, string>>;
  result?: VoidOrCorrectResult;
}

export async function deleteSaleAction(
  tenantSlug: string,
  _prevState: DeleteSaleState,
  formData: FormData
): Promise<DeleteSaleState> {
  const parsed = deleteSaleSchema.safeParse({
    saleId: formData.get("saleId"),
    reason: formData.get("reason") || undefined,
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof DeleteSaleInput>(parsed.error.issues),
    };
  }

  const supabase = await createClient();
  const salesService = new SalesService(supabase);

  try {
    const result = await salesService.deleteSale(parsed.data.saleId, parsed.data.reason);

    if (result.status === "deleted") {
      const [{ data: user }, { data: sale }] = await Promise.all([
        supabase.auth.getUser().then((r) => ({ data: r.data.user })),
        supabase.from("sales").select("tenant_id").eq("id", parsed.data.saleId).single(),
      ]);
      await new AuditService(createServiceRoleClient())
        .log({
          tenantId: sale?.tenant_id ?? null,
          actorProfileId: user?.id ?? null,
          action: AUDIT_ACTION.SALE_DELETED,
          entityType: "sale",
          entityId: parsed.data.saleId,
          reason: parsed.data.reason ?? null,
        })
        .catch(() => {});
    }

    revalidatePath(`/t/${tenantSlug}/sales-history`);
    return { result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not delete sale" };
  }
}

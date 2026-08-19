import { NextResponse } from "next/server";

import { ImportService } from "@/services/ImportService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * docs/12's "Import template generation" step -- a real, permission-
 * gated .xlsx download. Not passcode-gated the way 4g's exports are:
 * this file contains headers/instructions/one fabricated example row,
 * never real tenant data, so download security's "sales/transaction/
 * analytics/audit exports" scope doesn't apply to it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const { data: tenant } = await supabase.from("tenants").select("id").eq("slug", tenantSlug).single();
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  if (!(await can("imports.manage", { tenantId: tenant.id }))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const type = new URL(request.url).searchParams.get("type") === "products" ? "products" : "sales_history";
  const service = new ImportService(createServiceRoleClient());
  const buffer =
    type === "products" ? await service.generateProductsTemplate() : await service.generateSalesHistoryTemplate();

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        type === "products"
          ? 'attachment; filename="products-import-template.xlsx"'
          : 'attachment; filename="sales-history-import-template.xlsx"',
    },
  });
}

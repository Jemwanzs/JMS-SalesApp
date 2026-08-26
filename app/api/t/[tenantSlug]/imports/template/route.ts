import { NextResponse } from "next/server";

import { ImportService } from "@/services/ImportService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

/**
 * docs/12's "Import template generation" step -- a real, permission-
 * gated .xlsx download. The sales-history template now embeds this
 * tenant's own active product names and sales.create-holding members'
 * emails as real Excel dropdowns (not just written instructions), so
 * this is no longer literally zero tenant data the way it used to be --
 * still not passcode-gated the way 4g's exports are, though: product
 * names and staff emails aren't the "sales/transaction/analytics/audit
 * exports" download-security scope (docs/05), and the caller already
 * needed imports.manage to reach this route at all, same gate as before.
 */
export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const tenant = await getTenantBySlug(supabase, tenantSlug);
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  if (!(await can("imports.manage", { tenantId: tenant.id }))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const type = new URL(request.url).searchParams.get("type") === "products" ? "products" : "sales_history";
  const service = new ImportService(createServiceRoleClient());
  const buffer =
    type === "products"
      ? await service.generateProductsTemplate()
      : await service.generateSalesHistoryTemplate(tenant.id);

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

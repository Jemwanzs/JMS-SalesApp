import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/shared/back-link";
import { WhatsAppButton } from "@/components/shared/whatsapp-button";

import { CustomerPeriodFilter } from "@/features/orders/components/customer-period-filter";
import { CustomerTierBadge, TopCustomerStars } from "@/features/orders/components/customer-tier-badge";
import { OrderService } from "@/services/OrderService";
import { resolvePreset } from "@/lib/utils/date-ranges";
import { TenantService } from "@/services/TenantService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

export const metadata: Metadata = {
  title: "Customers | JMS Sales App",
};

export default async function OrderCustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ q?: string; period?: string }>;
}) {
  const { tenantSlug } = await params;
  const { q, period } = await searchParams;
  const supabase = await createClient();

  const [user, tenant] = await Promise.all([getCurrentUser(), getTenantBySlug(supabase, tenantSlug)]);
  if (!user) {
    redirect("/login");
  }
  if (!tenant) {
    notFound();
  }

  const [canViewCustomers, ordersEnabled] = await Promise.all([
    can("orders.view_customers", { tenantId: tenant.id }),
    new TenantService(supabase).getSetting<boolean>(tenant.id, "orders_enabled"),
  ]);
  if (!ordersEnabled || !canViewCustomers) {
    redirect(`/t/${tenantSlug}/more`);
  }

  const dateRange = period === "this_month" || period === "this_year" ? resolvePreset(period, tenant.timezone) : null;
  const customers = await new OrderService(supabase).listCustomers(tenant.id, {
    search: q || undefined,
    dateFrom: dateRange?.from,
    dateTo: dateRange?.to,
  });

  return (
    // pb-24 clears the sticky bottom nav -- see orders/[orderId]/page.tsx's own header comment.
    <div className="flex flex-1 flex-col p-6 pb-24">
      <BackLink href={`/t/${tenantSlug}/more`} label="More" />
      <h1 className="mb-4 text-xl font-semibold">Customers</h1>

      <form action={`/t/${tenantSlug}/orders/customers`} className="mb-4">
        {period && <input type="hidden" name="period" value={period} />}
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name or mobile number"
          className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring"
        />
      </form>

      <CustomerPeriodFilter />

      {customers.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <p className="text-sm text-muted-foreground">No customers yet.</p>
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {customers.map((customer) => (
            // "Stretched link" pattern -- see orders/page.tsx's own
            // header comment on this row for why (Phase 3b WhatsApp
            // click-to-chat needs an independently-clickable icon here).
            <div key={customer.id} className="relative flex items-center justify-between gap-3 p-4">
              <Link
                href={`/t/${tenantSlug}/orders/customers/${customer.id}`}
                className="absolute inset-0 hover:bg-muted"
                aria-label={customer.name}
              />
              <div className="min-w-0">
                {customer.isTopCustomer && <TopCustomerStars className="block text-xs text-amber-500" />}
                <p className="text-sm font-medium">{customer.name}</p>
                <p className="text-xs text-muted-foreground">{customer.mobileNumber}</p>
                {customer.defaultDeliveryLocation && (
                  <p className="text-xs text-muted-foreground">{customer.defaultDeliveryLocation}</p>
                )}
                {customer.tier && (
                  <p className="mt-1 text-xs">
                    <CustomerTierBadge tier={customer.tier} />
                    {" · "}
                    {customer.completedOrderValue.toFixed(2)} · {customer.completedOrderCount} Completed Orders
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <p className="text-sm text-muted-foreground">{customer.orderCount} orders</p>
                <WhatsAppButton mobile={customer.mobileNumber} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

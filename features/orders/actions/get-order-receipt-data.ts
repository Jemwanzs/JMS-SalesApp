"use server";

import { OrderService, type OrderReceiptData } from "@/services/OrderService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

/**
 * Uses the request-scoped RLS-respecting client, not service-role --
 * unlike getDailySalesReportAction's business-wide poster, a receipt is
 * reached FROM an order the caller already passed orders.view/view_all
 * RLS to see; orders.view_receipts is an additional narrowing gate on
 * top of that, not a replacement for it.
 */
export async function getOrderReceiptDataAction(tenantId: string, orderId: string): Promise<OrderReceiptData | null> {
  await assertCan("orders.view_receipts", { tenantId });

  const supabase = await createClient();
  return new OrderService(supabase).getOrderReceiptData(tenantId, orderId);
}

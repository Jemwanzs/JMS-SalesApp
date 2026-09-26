import type { SupabaseClient } from "@supabase/supabase-js";

import { TenantService } from "@/services/TenantService";
import { rankCustomers, type CustomerTier } from "@/lib/utils/customer-ranking";
import type { Database, OrderStatus } from "@/types/database.types";

const DEFAULT_RECEIPT_BACKGROUND_COLOR = "#0F7A3D";
const DEFAULT_RECEIPT_TEXT_COLOR = "#FFFFFF";
const DEFAULT_RECEIPT_FOOTER_MESSAGE = "Thank you for ordering with us. We appreciate your business.";

const ORDER_SELECT =
  "id, tenant_id, order_number, tracking_token, customer_id, customer_name_snapshot, customer_mobile_snapshot, delivery_location, delivery_directions, order_notes, order_total, status, attended_by, attended_at, delivery_person_name, delivery_person_mobile, delivery_notes, dispatched_at, completed_by, completed_at, processed_by_employee_id, processed_from_location_id, cancelled_by, cancelled_at, cancellation_reason, created_at, updated_at";

export interface OrderListItem {
  id: string;
  orderNumber: string | null;
  customerName: string;
  customerMobile: string;
  deliveryLocation: string;
  orderTotal: number;
  status: OrderStatus;
  createdAt: string;
}

export interface OrderCounts {
  received: number;
  beingAttended: number;
  onDelivery: number;
  completed: number;
}

export interface OrderItemRow {
  id: string;
  orderProductId: string | null;
  productNameSnapshot: string;
  productImageSnapshot: string | null;
  minimumOrderSnapshot: number | null;
  requestedAmount: number;
}

export interface OrderStatusHistoryEntry {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string;
  notes: string | null;
}

export interface OrderDetail {
  id: string;
  orderNumber: string | null;
  trackingToken: string;
  customerId: string | null;
  customerName: string;
  customerMobile: string;
  deliveryLocation: string;
  deliveryDirections: string | null;
  orderNotes: string | null;
  orderTotal: number;
  status: OrderStatus;
  attendedBy: string | null;
  attendedByName: string | null;
  attendedAt: string | null;
  deliveryPersonName: string | null;
  deliveryPersonMobile: string | null;
  deliveryNotes: string | null;
  dispatchedAt: string | null;
  completedBy: string | null;
  completedByName: string | null;
  completedAt: string | null;
  processedByEmployeeId: string | null;
  processedByEmployeeName: string | null;
  processedFromLocationId: string | null;
  processedFromLocationName: string | null;
  cancelledBy: string | null;
  cancelledByName: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  items: OrderItemRow[];
  statusHistory: OrderStatusHistoryEntry[];
}

export interface OrderFilters {
  status?: OrderStatus;
  dateFrom?: string;
  dateTo?: string;
  search?: string; // matches order_number or customer_name_snapshot
  locationId?: string; // processed_from_location_id -- branch performance filter
  employeeId?: string; // processed_by_employee_id -- employee performance filter
  limit?: number;
}

export interface OrderCustomerListItem {
  id: string;
  name: string;
  mobileNumber: string;
  defaultDeliveryLocation: string | null;
  orderCount: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  /**
   * Completed-order performance, ranked via lib/utils/customer-ranking.ts
   * -- cancelled/rejected/still-in-progress orders never contribute
   * (spec section 5's own "only successfully Completed Orders" rule).
   * Computed live at read time (no cached column anywhere on
   * order_customers), matching this codebase's existing product-
   * ranking precedent (AnalyticsService.getProductPerformance also
   * aggregates `sales` fresh on every read).
   */
  completedOrderCount: number;
  completedOrderValue: number;
  tier: CustomerTier | null;
  rank: number;
  isTopCustomer: boolean;
}

export interface OrderCustomerDetail extends OrderCustomerListItem {
  totalOrdered: number;
  averageCompletedOrderValue: number;
  lastCompletedOrderAt: string | null;
  orders: OrderListItem[];
}

/**
 * Branch Performance module. totalOrders/pendingOrders/onDeliveryOrders/
 * cancelledOrders are deliberately ALWAYS tenant-wide, never filtered by
 * locationId, even when a branch is selected -- processed_from_location_id
 * (migration 0098) is only ever set on a COMPLETED order, so filtering
 * these tenant-wide counts by branch would misreport "0 pending" for
 * every branch (a pending order never has a location yet). Only the
 * completed-order figures are meaningfully branch-scoped.
 */
export interface OrderAnalytics {
  totalOrders: number;
  completedOrders: number;
  pendingOrders: number;
  onDeliveryOrders: number;
  cancelledOrders: number;
  totalCompletedValue: number;
  averageCompletedValue: number;
}

export interface OrderTrendPoint {
  date: string;
  completedCount: number;
  completedValue: number;
}

export interface OrderBranchBreakdownItem {
  locationId: string;
  locationName: string;
  completedCount: number;
  completedValue: number;
}

export interface OrderEmployeeBreakdownItem {
  employeeId: string;
  employeeName: string;
  completedCount: number;
  completedValue: number;
}

export interface OrderReceiptItem {
  name: string;
  amount: number;
}

/**
 * Deliberately information-minimized to exactly what spec section 9's
 * own "Include"/"Do not expose" split calls for -- no ids, no actor
 * names, no internal notes (order_notes/delivery_notes) -- even though
 * this is fetched by staff, not the public: the receipt itself leaves
 * the app (download/share), so it gets the same discipline as the
 * public tracking DTO (PublicOrderingService.TrackedOrder).
 */
export interface OrderReceiptData {
  outletName: string;
  logoUrl: string | null;
  receiptWidth: "80mm" | "58mm";
  backgroundColor: string;
  textColor: string;
  showCustomerMobile: boolean;
  showDeliveryPerson: boolean;
  footerMessage: string;
  orderNumber: string | null;
  createdAt: string;
  status: OrderStatus;
  customerName: string;
  customerMobile: string;
  deliveryLocation: string;
  items: OrderReceiptItem[];
  orderTotal: number;
  deliveryPersonName: string | null;
  deliveryPersonMobile: string | null;
  cancellationReason: string | null;
}

function toOrderListItem(row: {
  id: string;
  order_number: string | null;
  customer_name_snapshot: string;
  customer_mobile_snapshot: string;
  delivery_location: string;
  order_total: number | string;
  status: OrderStatus;
  created_at: string;
}): OrderListItem {
  return {
    id: row.id,
    orderNumber: row.order_number,
    customerName: row.customer_name_snapshot,
    customerMobile: row.customer_mobile_snapshot,
    deliveryLocation: row.delivery_location,
    orderTotal: Number(row.order_total),
    status: row.status,
    createdAt: row.created_at,
  };
}

/**
 * The staff-side counterpart to PublicOrderingService -- always the
 * request-scoped RLS-respecting client (this is authenticated staff,
 * not an anonymous public actor), since orders_select/order_items_
 * select/order_status_history_select (migration 0092) already gate
 * reads correctly. All status MUTATION goes through the four
 * security-definer RPCs (migration 0093) -- there is still no UPDATE
 * RLS policy on these tables at all, matching sales' own long-standing
 * invariant; this service's own write methods are thin wrappers around
 * those RPCs, never a plain .update() call.
 */
export class OrderService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async getCounts(tenantId: string): Promise<OrderCounts> {
    const statuses: OrderStatus[] = ["received", "being_attended", "on_delivery", "completed"];
    const results = await Promise.all(
      statuses.map((status) =>
        this.supabase.from("orders").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", status)
      )
    );
    for (const r of results) {
      if (r.error) {
        throw new Error(`OrderService.getCounts: ${r.error.message}`);
      }
    }
    return {
      received: results[0].count ?? 0,
      beingAttended: results[1].count ?? 0,
      onDelivery: results[2].count ?? 0,
      completed: results[3].count ?? 0,
    };
  }

  async listOrders(tenantId: string, filters: OrderFilters = {}): Promise<OrderListItem[]> {
    let query = this.supabase
      .from("orders")
      .select("id, order_number, customer_name_snapshot, customer_mobile_snapshot, delivery_location, order_total, status, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(filters.limit ?? 50);

    if (filters.status) {
      query = query.eq("status", filters.status);
    }
    if (filters.dateFrom) {
      query = query.gte("created_at", filters.dateFrom);
    }
    if (filters.dateTo) {
      query = query.lte("created_at", filters.dateTo);
    }
    if (filters.search) {
      query = query.or(`order_number.ilike.%${filters.search}%,customer_name_snapshot.ilike.%${filters.search}%`);
    }
    if (filters.locationId) {
      query = query.eq("processed_from_location_id", filters.locationId);
    }
    if (filters.employeeId) {
      query = query.eq("processed_by_employee_id", filters.employeeId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`OrderService.listOrders: ${error.message}`);
    }
    return (data ?? []).map(toOrderListItem);
  }

  async getOrderDetail(tenantId: string, orderId: string): Promise<OrderDetail | null> {
    const { data: order, error } = await this.supabase
      .from("orders")
      .select(ORDER_SELECT)
      .eq("tenant_id", tenantId)
      .eq("id", orderId)
      .maybeSingle();

    if (error) {
      throw new Error(`OrderService.getOrderDetail: ${error.message}`);
    }
    if (!order) {
      return null;
    }

    const [{ data: items, error: itemsError }, { data: history, error: historyError }] = await Promise.all([
      this.supabase
        .from("order_items")
        .select("id, order_product_id, product_name_snapshot, product_image_snapshot, minimum_order_snapshot, requested_amount")
        .eq("order_id", orderId),
      this.supabase
        .from("order_status_history")
        .select("id, from_status, to_status, changed_by, changed_at, notes")
        .eq("order_id", orderId)
        .order("changed_at", { ascending: true }),
    ]);

    if (itemsError) {
      throw new Error(`OrderService.getOrderDetail: ${itemsError.message}`);
    }
    if (historyError) {
      throw new Error(`OrderService.getOrderDetail: ${historyError.message}`);
    }

    // Fetch-then-map for actor display names -- same "raw rows, joined
    // in application code" convention this codebase's dashboards
    // already use, rather than relying on a PostgREST embed.
    const actorIds = new Set<string>();
    if (order.attended_by) actorIds.add(order.attended_by);
    if (order.completed_by) actorIds.add(order.completed_by);
    if (order.cancelled_by) actorIds.add(order.cancelled_by);
    if (order.processed_by_employee_id) actorIds.add(order.processed_by_employee_id);
    for (const h of history ?? []) {
      if (h.changed_by) actorIds.add(h.changed_by);
    }

    const [{ data: profiles }, { data: location }] = await Promise.all([
      actorIds.size > 0
        ? this.supabase.from("profiles").select("id, full_name").in("id", [...actorIds])
        : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
      order.processed_from_location_id
        ? this.supabase.from("locations").select("name").eq("id", order.processed_from_location_id).maybeSingle()
        : Promise.resolve({ data: null as { name: string } | null }),
    ]);

    const nameById = new Map<string, string>();
    for (const p of profiles ?? []) {
      if (p.full_name) nameById.set(p.id, p.full_name);
    }

    return {
      id: order.id,
      orderNumber: order.order_number,
      trackingToken: order.tracking_token,
      customerId: order.customer_id,
      customerName: order.customer_name_snapshot,
      customerMobile: order.customer_mobile_snapshot,
      deliveryLocation: order.delivery_location,
      deliveryDirections: order.delivery_directions,
      orderNotes: order.order_notes,
      orderTotal: Number(order.order_total),
      status: order.status,
      attendedBy: order.attended_by,
      attendedByName: order.attended_by ? (nameById.get(order.attended_by) ?? null) : null,
      attendedAt: order.attended_at,
      deliveryPersonName: order.delivery_person_name,
      deliveryPersonMobile: order.delivery_person_mobile,
      deliveryNotes: order.delivery_notes,
      dispatchedAt: order.dispatched_at,
      completedBy: order.completed_by,
      completedByName: order.completed_by ? (nameById.get(order.completed_by) ?? null) : null,
      completedAt: order.completed_at,
      processedByEmployeeId: order.processed_by_employee_id,
      processedByEmployeeName: order.processed_by_employee_id ? (nameById.get(order.processed_by_employee_id) ?? null) : null,
      processedFromLocationId: order.processed_from_location_id,
      processedFromLocationName: location?.name ?? null,
      cancelledBy: order.cancelled_by,
      cancelledByName: order.cancelled_by ? (nameById.get(order.cancelled_by) ?? null) : null,
      cancelledAt: order.cancelled_at,
      cancellationReason: order.cancellation_reason,
      createdAt: order.created_at,
      items: (items ?? []).map((i) => ({
        id: i.id,
        orderProductId: i.order_product_id,
        productNameSnapshot: i.product_name_snapshot,
        productImageSnapshot: i.product_image_snapshot,
        minimumOrderSnapshot: i.minimum_order_snapshot === null ? null : Number(i.minimum_order_snapshot),
        requestedAmount: Number(i.requested_amount),
      })),
      statusHistory: (history ?? []).map((h) => ({
        id: h.id,
        fromStatus: h.from_status,
        toStatus: h.to_status,
        changedBy: h.changed_by,
        changedByName: h.changed_by ? (nameById.get(h.changed_by) ?? null) : null,
        changedAt: h.changed_at,
        notes: h.notes,
      })),
    };
  }

  /**
   * Side-effect call from the order detail page render -- see that
   * page's own comment for why viewing triggers this. Returns the
   * updated row (the RPC already returns it) so the caller can patch
   * its in-memory order object directly instead of re-querying getOrderDetail()
   * right after -- a second read of the exact same orders/order_items/
   * order_status_history queries within the SAME request would hit
   * React's automatic fetch request memoization and silently return the
   * PRE-mutation response (confirmed live: DB correctly showed
   * being_attended while the re-fetched page still rendered "Received").
   * getCurrentUser() (lib/supabase/current-user.ts) is deliberately
   * wrapped in the same cache() for the opposite reason -- memoizing an
   * unchanging read is desirable there; memoizing a read straddling a
   * mutation is the bug here.
   */
  async attendOrder(orderId: string): Promise<Database["public"]["Tables"]["orders"]["Row"]> {
    const { data, error } = await this.supabase.rpc("attend_order", { p_order_id: orderId });
    if (error || !data) {
      throw new Error(`OrderService.attendOrder: ${error?.message ?? "no row returned"}`);
    }
    return data;
  }

  async markOnDelivery(orderId: string, deliveryPersonName: string, deliveryPersonMobile: string, deliveryNotes: string | null): Promise<void> {
    const { error } = await this.supabase.rpc("mark_order_on_delivery", {
      p_order_id: orderId,
      p_delivery_person_name: deliveryPersonName,
      p_delivery_person_mobile: deliveryPersonMobile,
      p_delivery_notes: deliveryNotes,
    });
    if (error) {
      throw new Error(`OrderService.markOnDelivery: ${error.message}`);
    }
  }

  async completeOrder(orderId: string, employeeId: string, locationId: string): Promise<void> {
    const { error } = await this.supabase.rpc("complete_order", {
      p_order_id: orderId,
      p_employee_id: employeeId,
      p_location_id: locationId,
    });
    if (error) {
      throw new Error(`OrderService.completeOrder: ${error.message}`);
    }
  }

  async cancelOrder(orderId: string, reason: string): Promise<void> {
    const { error } = await this.supabase.rpc("cancel_order", { p_order_id: orderId, p_reason: reason });
    if (error) {
      throw new Error(`OrderService.cancelOrder: ${error.message}`);
    }
  }

  /**
   * `dateFrom`/`dateTo` filter by `orders.completed_at` (when the
   * order's value was actually realized), not `created_at` -- matches
   * Phase A's own "sale_date = completion date, not creation date"
   * convention. Omitted = All Time (spec section 9's own default),
   * matching how every other unfiltered view in this app treats "no
   * range given" rather than forcing an artificial bound.
   */
  async listCustomers(tenantId: string, options: { search?: string; dateFrom?: string; dateTo?: string } = {}): Promise<OrderCustomerListItem[]> {
    let query = this.supabase
      .from("order_customers")
      .select("id, name, mobile_number, default_delivery_location, order_count, first_order_at, last_order_at")
      .eq("tenant_id", tenantId);

    if (options.search) {
      query = query.or(`name.ilike.%${options.search}%,mobile_number.ilike.%${options.search}%`);
    }

    const [{ data, error }, completedTotals] = await Promise.all([
      query,
      this.getCompletedOrderTotalsByCustomer(tenantId, options.dateFrom, options.dateTo),
    ]);
    if (error) {
      throw new Error(`OrderService.listCustomers: ${error.message}`);
    }

    const customers = (data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      mobileNumber: c.mobile_number,
      defaultDeliveryLocation: c.default_delivery_location,
      orderCount: c.order_count,
      firstOrderAt: c.first_order_at,
      lastOrderAt: c.last_order_at,
    }));

    return rankCustomers(customers, completedTotals.valueByCustomerId).map((c) => ({
      ...c,
      completedOrderCount: completedTotals.countByCustomerId.get(c.id) ?? 0,
      completedOrderValue: c.completedValue,
    }));
  }

  /** Shared aggregation behind listCustomers/getCustomerDetail -- one place computing "completed orders only, in this date range, per customer." */
  private async getCompletedOrderTotalsByCustomer(
    tenantId: string,
    dateFrom?: string,
    dateTo?: string
  ): Promise<{ valueByCustomerId: Map<string, number>; countByCustomerId: Map<string, number> }> {
    let query = this.supabase
      .from("orders")
      .select("customer_id, order_total")
      .eq("tenant_id", tenantId)
      .eq("status", "completed")
      .not("customer_id", "is", null);

    if (dateFrom) {
      query = query.gte("completed_at", `${dateFrom}T00:00:00.000Z`);
    }
    if (dateTo) {
      query = query.lte("completed_at", `${dateTo}T23:59:59.999Z`);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`OrderService.getCompletedOrderTotalsByCustomer: ${error.message}`);
    }

    const valueByCustomerId = new Map<string, number>();
    const countByCustomerId = new Map<string, number>();
    for (const row of data ?? []) {
      if (!row.customer_id) continue;
      valueByCustomerId.set(row.customer_id, (valueByCustomerId.get(row.customer_id) ?? 0) + Number(row.order_total));
      countByCustomerId.set(row.customer_id, (countByCustomerId.get(row.customer_id) ?? 0) + 1);
    }
    return { valueByCustomerId, countByCustomerId };
  }

  async getCustomerDetail(
    tenantId: string,
    customerId: string,
    options: { dateFrom?: string; dateTo?: string } = {}
  ): Promise<OrderCustomerDetail | null> {
    const { data: customer, error } = await this.supabase
      .from("order_customers")
      .select("id, name, mobile_number, default_delivery_location, order_count, first_order_at, last_order_at")
      .eq("tenant_id", tenantId)
      .eq("id", customerId)
      .maybeSingle();

    if (error) {
      throw new Error(`OrderService.getCustomerDetail: ${error.message}`);
    }
    if (!customer) {
      return null;
    }

    const [{ data: orders, error: ordersError }, rankedCustomers] = await Promise.all([
      this.supabase
        .from("orders")
        .select("id, order_number, customer_name_snapshot, customer_mobile_snapshot, delivery_location, order_total, status, created_at, completed_at")
        .eq("tenant_id", tenantId)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false }),
      // Rank/tier are inherently relative to every OTHER customer, not
      // computable from this one customer's own rows -- reuses
      // listCustomers' own ranking (same date range), then picks out
      // just this customer's entry.
      this.listCustomers(tenantId, { dateFrom: options.dateFrom, dateTo: options.dateTo }),
    ]);

    if (ordersError) {
      throw new Error(`OrderService.getCustomerDetail: ${ordersError.message}`);
    }

    const orderList = (orders ?? []).map(toOrderListItem);
    const totalOrdered = orderList.reduce((sum, o) => sum + o.orderTotal, 0);

    const ranked = rankedCustomers.find((c) => c.id === customerId);
    const completedOrderCount = ranked?.completedOrderCount ?? 0;
    const completedOrderValue = ranked?.completedOrderValue ?? 0;
    const averageCompletedOrderValue = completedOrderCount > 0 ? completedOrderValue / completedOrderCount : 0;

    const completedRows = (orders ?? []).filter((o) => {
      if (o.status !== "completed" || !o.completed_at) return false;
      if (options.dateFrom && o.completed_at < `${options.dateFrom}T00:00:00.000Z`) return false;
      if (options.dateTo && o.completed_at > `${options.dateTo}T23:59:59.999Z`) return false;
      return true;
    });
    const lastCompletedOrderAt =
      completedRows.length > 0 ? completedRows.reduce((latest, o) => (o.completed_at! > latest ? o.completed_at! : latest), completedRows[0].completed_at!) : null;

    return {
      id: customer.id,
      name: customer.name,
      mobileNumber: customer.mobile_number,
      defaultDeliveryLocation: customer.default_delivery_location,
      orderCount: customer.order_count,
      firstOrderAt: customer.first_order_at,
      lastOrderAt: customer.last_order_at,
      completedOrderCount,
      completedOrderValue,
      tier: ranked?.tier ?? null,
      rank: ranked?.rank ?? 0,
      isTopCustomer: ranked?.isTopCustomer ?? false,
      totalOrdered,
      averageCompletedOrderValue,
      lastCompletedOrderAt,
      orders: orderList,
    };
  }

  /**
   * Feeds both the receipt preview dialog and buildOrderReceiptPdf() --
   * one flat DTO so the two never drift out of sync with each other.
   * Reuses the same tenant.name / order_outlet_name fallback chain the
   * public storefront already established (PublicOrderingService.
   * getStorefront), and the same "receipt_footer_message falls back to
   * order_completion_message, then a hardcoded default" chain the
   * receipt settings card's own placeholder documents.
   */
  async getOrderReceiptData(tenantId: string, orderId: string): Promise<OrderReceiptData | null> {
    const [{ data: tenant }, { data: order }, settings] = await Promise.all([
      this.supabase.from("tenants").select("name, logo_url").eq("id", tenantId).maybeSingle(),
      this.supabase
        .from("orders")
        .select(
          "order_number, created_at, status, customer_name_snapshot, customer_mobile_snapshot, delivery_location, order_total, delivery_person_name, delivery_person_mobile, cancellation_reason"
        )
        .eq("tenant_id", tenantId)
        .eq("id", orderId)
        .maybeSingle(),
      new TenantService(this.supabase).getSettings(tenantId, [
        "order_outlet_name",
        "order_completion_message",
        "receipt_show_logo",
        "receipt_width",
        "receipt_background_color",
        "receipt_text_color",
        "receipt_show_customer_mobile",
        "receipt_show_delivery_person",
        "receipt_footer_message",
      ]),
    ]);

    if (!order) {
      return null;
    }

    const { data: items } = await this.supabase.from("order_items").select("product_name_snapshot, requested_amount").eq("order_id", orderId);

    const showLogo = (settings.receipt_show_logo as boolean | undefined) ?? true;

    return {
      outletName: (settings.order_outlet_name as string | undefined) || tenant?.name || "",
      logoUrl: showLogo ? (tenant?.logo_url ?? null) : null,
      receiptWidth: ((settings.receipt_width as string | undefined) === "58mm" ? "58mm" : "80mm") as "80mm" | "58mm",
      backgroundColor: (settings.receipt_background_color as string | undefined) || DEFAULT_RECEIPT_BACKGROUND_COLOR,
      textColor: (settings.receipt_text_color as string | undefined) || DEFAULT_RECEIPT_TEXT_COLOR,
      showCustomerMobile: (settings.receipt_show_customer_mobile as boolean | undefined) ?? true,
      showDeliveryPerson: (settings.receipt_show_delivery_person as boolean | undefined) ?? true,
      footerMessage:
        (settings.receipt_footer_message as string | undefined) ||
        (settings.order_completion_message as string | undefined) ||
        DEFAULT_RECEIPT_FOOTER_MESSAGE,
      orderNumber: order.order_number,
      createdAt: order.created_at,
      status: order.status,
      customerName: order.customer_name_snapshot,
      customerMobile: order.customer_mobile_snapshot,
      deliveryLocation: order.delivery_location,
      items: (items ?? []).map((i) => ({ name: i.product_name_snapshot, amount: Number(i.requested_amount) })),
      orderTotal: Number(order.order_total),
      deliveryPersonName: order.delivery_person_name,
      deliveryPersonMobile: order.delivery_person_mobile,
      cancellationReason: order.cancellation_reason,
    };
  }

  /**
   * Branch Performance's Orders tab. `range` bounds `created_at` (every
   * order, regardless of status) for the tenant-wide counts, and
   * `completed_at` for the completed-order value figures -- an order
   * created in-range but completed outside it (or vice versa) is
   * intentionally not double-counted between the two: totalOrders etc.
   * reflect orders CREATED in range, totalCompletedValue reflects orders
   * COMPLETED in range, matching how a staff member would actually read
   * "orders this period" vs "value completed this period."
   */
  async getOrderAnalytics(
    tenantId: string,
    range: { from: string; to: string },
    locationId?: string | null
  ): Promise<OrderAnalytics> {
    const [{ data: createdRows, error: createdError }, { data: completedRows, error: completedError }] = await Promise.all([
      this.supabase
        .from("orders")
        .select("status")
        .eq("tenant_id", tenantId)
        .gte("created_at", range.from)
        .lte("created_at", range.to),
      this.supabase
        .from("orders")
        .select("order_total, processed_from_location_id")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .gte("completed_at", range.from)
        .lte("completed_at", range.to),
    ]);
    if (createdError) throw new Error(`OrderService.getOrderAnalytics: ${createdError.message}`);
    if (completedError) throw new Error(`OrderService.getOrderAnalytics: ${completedError.message}`);

    const all = createdRows ?? [];
    const completed = (completedRows ?? []).filter((r) => !locationId || r.processed_from_location_id === locationId);
    const totalCompletedValue = completed.reduce((sum, r) => sum + Number(r.order_total), 0);

    return {
      totalOrders: all.length,
      completedOrders: completed.length,
      pendingOrders: all.filter((r) => r.status === "received" || r.status === "being_attended").length,
      onDeliveryOrders: all.filter((r) => r.status === "on_delivery").length,
      cancelledOrders: all.filter((r) => r.status === "cancelled" || r.status === "rejected").length,
      totalCompletedValue,
      averageCompletedValue: completed.length > 0 ? totalCompletedValue / completed.length : 0,
    };
  }

  /** Day-bucketed completed-order count/value, same shape as AnalyticsService.getDailyTrend. */
  async getOrderTrend(
    tenantId: string,
    range: { from: string; to: string },
    locationId?: string | null
  ): Promise<OrderTrendPoint[]> {
    let query = this.supabase
      .from("orders")
      .select("completed_at, order_total")
      .eq("tenant_id", tenantId)
      .eq("status", "completed")
      .gte("completed_at", range.from)
      .lte("completed_at", range.to);
    if (locationId) {
      query = query.eq("processed_from_location_id", locationId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`OrderService.getOrderTrend: ${error.message}`);

    const byDate = new Map<string, { count: number; value: number }>();
    for (const row of data ?? []) {
      if (!row.completed_at) continue;
      const date = row.completed_at.slice(0, 10);
      const entry = byDate.get(date) ?? { count: 0, value: 0 };
      entry.count += 1;
      entry.value += Number(row.order_total);
      byDate.set(date, entry);
    }

    return [...byDate.entries()]
      .map(([date, { count, value }]) => ({ date, completedCount: count, completedValue: value }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Completed orders grouped by processed_from_location_id -- the "All Branches" breakdown itself, not filtered by a single branch. */
  async getOrdersByBranch(tenantId: string, range: { from: string; to: string }): Promise<OrderBranchBreakdownItem[]> {
    const { data, error } = await this.supabase
      .from("orders")
      .select("processed_from_location_id, order_total")
      .eq("tenant_id", tenantId)
      .eq("status", "completed")
      .not("processed_from_location_id", "is", null)
      .gte("completed_at", range.from)
      .lte("completed_at", range.to);
    if (error) throw new Error(`OrderService.getOrdersByBranch: ${error.message}`);

    const byLocation = new Map<string, { count: number; value: number }>();
    for (const row of data ?? []) {
      const locationId = row.processed_from_location_id!;
      const entry = byLocation.get(locationId) ?? { count: 0, value: 0 };
      entry.count += 1;
      entry.value += Number(row.order_total);
      byLocation.set(locationId, entry);
    }

    const locationIds = [...byLocation.keys()];
    const { data: locations } =
      locationIds.length > 0 ? await this.supabase.from("locations").select("id, name").in("id", locationIds) : { data: [] };
    const nameById = new Map((locations ?? []).map((l) => [l.id, l.name]));

    return [...byLocation.entries()]
      .map(([locationId, agg]) => ({
        locationId,
        locationName: nameById.get(locationId) ?? "Unknown branch",
        completedCount: agg.count,
        completedValue: agg.value,
      }))
      .sort((a, b) => b.completedValue - a.completedValue);
  }

  /** Completed orders grouped by processed_by_employee_id, optionally scoped to one branch. */
  async getOrdersByEmployee(
    tenantId: string,
    range: { from: string; to: string },
    locationId?: string | null
  ): Promise<OrderEmployeeBreakdownItem[]> {
    let query = this.supabase
      .from("orders")
      .select("processed_by_employee_id, order_total")
      .eq("tenant_id", tenantId)
      .eq("status", "completed")
      .not("processed_by_employee_id", "is", null)
      .gte("completed_at", range.from)
      .lte("completed_at", range.to);
    if (locationId) {
      query = query.eq("processed_from_location_id", locationId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`OrderService.getOrdersByEmployee: ${error.message}`);

    const byEmployee = new Map<string, { count: number; value: number }>();
    for (const row of data ?? []) {
      const employeeId = row.processed_by_employee_id!;
      const entry = byEmployee.get(employeeId) ?? { count: 0, value: 0 };
      entry.count += 1;
      entry.value += Number(row.order_total);
      byEmployee.set(employeeId, entry);
    }

    const employeeIds = [...byEmployee.keys()];
    const { data: profiles } =
      employeeIds.length > 0 ? await this.supabase.from("profiles").select("id, full_name").in("id", employeeIds) : { data: [] };
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

    return [...byEmployee.entries()]
      .map(([employeeId, agg]) => ({
        employeeId,
        employeeName: nameById.get(employeeId) ?? "Unknown employee",
        completedCount: agg.count,
        completedValue: agg.value,
      }))
      .sort((a, b) => b.completedValue - a.completedValue);
  }
}

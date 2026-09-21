import type { SupabaseClient } from "@supabase/supabase-js";

import { TenantService } from "@/services/TenantService";
import type { Database, OrderStatus } from "@/types/database.types";

const DEFAULT_RECEIPT_BACKGROUND_COLOR = "#0F7A3D";
const DEFAULT_RECEIPT_TEXT_COLOR = "#FFFFFF";
const DEFAULT_RECEIPT_FOOTER_MESSAGE = "Thank you for ordering with us. We appreciate your business.";

const ORDER_SELECT =
  "id, tenant_id, order_number, tracking_token, customer_id, customer_name_snapshot, customer_mobile_snapshot, delivery_location, delivery_directions, order_notes, order_total, status, attended_by, attended_at, delivery_person_name, delivery_person_mobile, delivery_notes, dispatched_at, completed_by, completed_at, cancelled_by, cancelled_at, cancellation_reason, created_at, updated_at";

export interface OrderListItem {
  id: string;
  orderNumber: string | null;
  customerName: string;
  customerMobile: string;
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
}

export interface OrderCustomerDetail extends OrderCustomerListItem {
  totalOrdered: number;
  orders: OrderListItem[];
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
  order_total: number | string;
  status: OrderStatus;
  created_at: string;
}): OrderListItem {
  return {
    id: row.id,
    orderNumber: row.order_number,
    customerName: row.customer_name_snapshot,
    customerMobile: row.customer_mobile_snapshot,
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
      .select("id, order_number, customer_name_snapshot, customer_mobile_snapshot, order_total, status, created_at")
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
    for (const h of history ?? []) {
      if (h.changed_by) actorIds.add(h.changed_by);
    }

    const nameById = new Map<string, string>();
    if (actorIds.size > 0) {
      const { data: profiles } = await this.supabase.from("profiles").select("id, full_name").in("id", [...actorIds]);
      for (const p of profiles ?? []) {
        if (p.full_name) nameById.set(p.id, p.full_name);
      }
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

  async completeOrder(orderId: string): Promise<void> {
    const { error } = await this.supabase.rpc("complete_order", { p_order_id: orderId });
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

  async listCustomers(tenantId: string, search?: string): Promise<OrderCustomerListItem[]> {
    let query = this.supabase
      .from("order_customers")
      .select("id, name, mobile_number, default_delivery_location, order_count, first_order_at, last_order_at")
      .eq("tenant_id", tenantId)
      .order("last_order_at", { ascending: false });

    if (search) {
      query = query.or(`name.ilike.%${search}%,mobile_number.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`OrderService.listCustomers: ${error.message}`);
    }
    return (data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      mobileNumber: c.mobile_number,
      defaultDeliveryLocation: c.default_delivery_location,
      orderCount: c.order_count,
      firstOrderAt: c.first_order_at,
      lastOrderAt: c.last_order_at,
    }));
  }

  async getCustomerDetail(tenantId: string, customerId: string): Promise<OrderCustomerDetail | null> {
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

    const { data: orders, error: ordersError } = await this.supabase
      .from("orders")
      .select("id, order_number, customer_name_snapshot, customer_mobile_snapshot, order_total, status, created_at")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });

    if (ordersError) {
      throw new Error(`OrderService.getCustomerDetail: ${ordersError.message}`);
    }

    const orderList = (orders ?? []).map(toOrderListItem);
    const totalOrdered = orderList.reduce((sum, o) => sum + o.orderTotal, 0);

    return {
      id: customer.id,
      name: customer.name,
      mobileNumber: customer.mobile_number,
      defaultDeliveryLocation: customer.default_delivery_location,
      orderCount: customer.order_count,
      firstOrderAt: customer.first_order_at,
      lastOrderAt: customer.last_order_at,
      totalOrdered,
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
}

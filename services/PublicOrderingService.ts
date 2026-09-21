import type { SupabaseClient } from "@supabase/supabase-js";

import { TenantService } from "@/services/TenantService";
import type { Database } from "@/types/database.types";

const DEFAULT_DELIVERY_FEE_NOTICE =
  "Your order will be delivered using a motorbike/courier service. The applicable delivery fee will be paid separately on delivery and is not included in the order total.";
const DEFAULT_COMPLETION_MESSAGE = "Thank you for ordering with us. We appreciate your business and look forward to serving you again.";

export interface StorefrontProduct {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  minimumOrderAmount: number;
}

export interface Storefront {
  tenantId: string;
  tenantSlug: string;
  outletName: string;
  logoUrl: string | null;
  welcomeMessage: string | null;
  deliveryFeeNotice: string;
  completionMessage: string;
  products: StorefrontProduct[];
}

export interface SubmitOrderItemInput {
  orderProductId: string;
  requestedAmount: number;
}

export interface SubmitOrderInput {
  tenantSlug: string;
  customerName: string;
  mobileNumber: string;
  deliveryLocation: string;
  deliveryDirections?: string | null;
  orderNotes?: string | null;
  idempotencyKey: string;
  items: SubmitOrderItemInput[];
}

export interface SubmitOrderResult {
  orderNumber: string;
  trackingToken: string;
  orderTotal: number;
  replayed: boolean;
}

/**
 * The ONLY service that ever touches Customer Orders data on behalf of
 * an anonymous public visitor -- always constructed with the service-
 * role client (there is zero `to anon` RLS anywhere in this codebase,
 * confirmed before writing Phase 2a's own migration), so every check a
 * normal RLS policy would otherwise provide has to happen explicitly,
 * in this file, in application code. Mirrors features/platform-admin/
 * actions/*.ts's own "no database backstop, this check IS the real
 * enforcement" posture -- just for a public actor instead of a
 * platform admin.
 */
export class PublicOrderingService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /**
   * Returns null for EVERY failure mode (tenant doesn't exist, Orders
   * Module off, Public Ordering off) -- deliberately indistinguishable
   * from the caller's point of view, so the public page can render one
   * clean "not available" message without leaking whether a given
   * tenant slug even exists (avoids tenant-slug enumeration).
   */
  async getStorefront(tenantSlug: string): Promise<Storefront | null> {
    const { data: tenant, error: tenantError } = await this.supabase
      .from("tenants")
      .select("id, slug, name, logo_url, status")
      .eq("slug", tenantSlug)
      .maybeSingle();

    if (tenantError || !tenant || tenant.status !== "active") {
      return null;
    }

    const tenantService = new TenantService(this.supabase);
    const settings = await tenantService.getSettings(tenant.id, [
      "orders_enabled",
      "public_ordering_enabled",
      "order_outlet_name",
      "order_welcome_message",
      "order_delivery_fee_notice",
      "order_completion_message",
    ]);

    if (!settings.orders_enabled || !settings.public_ordering_enabled) {
      return null;
    }

    const { data: products, error: productsError } = await this.supabase
      .from("order_products")
      .select("id, name, description, image_url, minimum_order_amount")
      .eq("tenant_id", tenant.id)
      .eq("status", "active")
      .eq("is_available", true)
      .order("display_order", { ascending: true })
      .order("name", { ascending: true });

    if (productsError) {
      throw new Error(`PublicOrderingService.getStorefront: ${productsError.message}`);
    }

    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      outletName: (settings.order_outlet_name as string | undefined) || tenant.name,
      logoUrl: tenant.logo_url,
      welcomeMessage: (settings.order_welcome_message as string | undefined) || null,
      deliveryFeeNotice: (settings.order_delivery_fee_notice as string | undefined) || DEFAULT_DELIVERY_FEE_NOTICE,
      completionMessage: (settings.order_completion_message as string | undefined) || DEFAULT_COMPLETION_MESSAGE,
      products: (products ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        imageUrl: p.image_url,
        minimumOrderAmount: Number(p.minimum_order_amount),
      })),
    };
  }

  /**
   * Full server-side re-validation -- nothing about the cart's contents
   * or total is trusted from the client. Every order_product_id is
   * re-fetched fresh (must belong to this tenant, be active+available,
   * and the requested amount must clear ITS current minimum, not
   * whatever the client believed the minimum was when the page loaded).
   * order_customers is upserted by (tenant_id, mobile_number) -- the
   * table's own unique constraint (migration 0092) is what actually
   * prevents a duplicate customer record, this is just the read-then-
   * write around it. Idempotency mirrors SalesService.recordSale
   * exactly: insert, and on a (tenant_id, idempotency_key) conflict,
   * re-select and return the existing order as a successful replay
   * rather than an error -- a network retry or double-tap must never
   * create a second order.
   */
  async submitOrder(input: SubmitOrderInput): Promise<SubmitOrderResult> {
    const { data: tenant } = await this.supabase.from("tenants").select("id, status").eq("slug", input.tenantSlug).maybeSingle();
    if (!tenant || tenant.status !== "active") {
      throw new Error("This ordering page is not available");
    }

    const tenantService = new TenantService(this.supabase);
    const settings = await tenantService.getSettings(tenant.id, ["orders_enabled", "public_ordering_enabled"]);
    if (!settings.orders_enabled || !settings.public_ordering_enabled) {
      throw new Error("This ordering page is not available");
    }

    if (input.items.length === 0) {
      throw new Error("Your cart is empty");
    }

    const productIds = input.items.map((i) => i.orderProductId);
    const { data: products, error: productsError } = await this.supabase
      .from("order_products")
      .select("id, name, image_url, minimum_order_amount, status, is_available")
      .eq("tenant_id", tenant.id)
      .in("id", productIds);

    if (productsError) {
      throw new Error(`PublicOrderingService.submitOrder: ${productsError.message}`);
    }

    const productById = new Map((products ?? []).map((p) => [p.id, p]));
    let orderTotal = 0;
    const itemRows: {
      order_product_id: string;
      product_name_snapshot: string;
      product_image_snapshot: string | null;
      minimum_order_snapshot: number;
      requested_amount: number;
    }[] = [];

    for (const item of input.items) {
      const product = productById.get(item.orderProductId);
      if (!product || product.status !== "active" || !product.is_available) {
        throw new Error("One of the items in your cart is no longer available. Please review your cart and try again.");
      }
      const minimum = Number(product.minimum_order_amount);
      if (item.requestedAmount < minimum) {
        throw new Error(`Minimum order for ${product.name} is ${minimum.toFixed(2)}.`);
      }
      orderTotal += item.requestedAmount;
      itemRows.push({
        order_product_id: product.id,
        product_name_snapshot: product.name,
        product_image_snapshot: product.image_url,
        minimum_order_snapshot: minimum,
        requested_amount: item.requestedAmount,
      });
    }

    const customerId = await this.upsertCustomer(tenant.id, input.customerName, input.mobileNumber, input.deliveryLocation);

    const { data: insertedOrder, error: insertError } = await this.supabase
      .from("orders")
      .insert({
        tenant_id: tenant.id,
        idempotency_key: input.idempotencyKey,
        customer_id: customerId,
        customer_name_snapshot: input.customerName,
        customer_mobile_snapshot: input.mobileNumber,
        delivery_location: input.deliveryLocation,
        delivery_directions: input.deliveryDirections || null,
        order_notes: input.orderNotes || null,
        order_total: orderTotal,
      })
      .select("id, order_number, tracking_token, order_total")
      .maybeSingle();

    if (insertError && insertError.code !== "23505") {
      throw new Error(`PublicOrderingService.submitOrder: ${insertError.message}`);
    }

    if (insertedOrder) {
      const { error: itemsError } = await this.supabase
        .from("order_items")
        .insert(itemRows.map((row) => ({ ...row, tenant_id: tenant.id, order_id: insertedOrder.id })));
      if (itemsError) {
        throw new Error(`PublicOrderingService.submitOrder: ${itemsError.message}`);
      }

      await this.supabase.from("order_status_history").insert({
        tenant_id: tenant.id,
        order_id: insertedOrder.id,
        from_status: null,
        to_status: "received",
      });

      return {
        orderNumber: insertedOrder.order_number ?? "",
        trackingToken: insertedOrder.tracking_token,
        orderTotal: Number(insertedOrder.order_total),
        replayed: false,
      };
    }

    // Conflict on (tenant_id, idempotency_key) -- a retry of a
    // submission that already succeeded. Re-select and return the
    // existing order rather than erroring; order_items were already
    // inserted the first time, never re-inserted here.
    const { data: existing, error: lookupError } = await this.supabase
      .from("orders")
      .select("order_number, tracking_token, order_total")
      .eq("tenant_id", tenant.id)
      .eq("idempotency_key", input.idempotencyKey)
      .single();

    if (lookupError || !existing) {
      throw new Error(`PublicOrderingService.submitOrder: idempotent insert conflicted but the existing row could not be found`);
    }

    return {
      orderNumber: existing.order_number ?? "",
      trackingToken: existing.tracking_token,
      orderTotal: Number(existing.order_total),
      replayed: true,
    };
  }

  /**
   * Reuses the existing order_customers row for this mobile number if
   * one exists (spec: "reuse the existing customer record... instead
   * of unnecessarily creating duplicates") -- the table's own unique
   * (tenant_id, mobile_number) constraint (migration 0092) is the real
   * backstop; this is a plain read-then-upsert around it, matching
   * this file's own "no RLS to rely on, do it explicitly" posture.
   */
  private async upsertCustomer(tenantId: string, name: string, mobileNumber: string, deliveryLocation: string): Promise<string> {
    const { data: existing } = await this.supabase
      .from("order_customers")
      .select("id, order_count")
      .eq("tenant_id", tenantId)
      .eq("mobile_number", mobileNumber)
      .maybeSingle();

    const nowIso = new Date().toISOString();

    if (existing) {
      const { error } = await this.supabase
        .from("order_customers")
        .update({
          name,
          default_delivery_location: deliveryLocation,
          last_order_at: nowIso,
          order_count: existing.order_count + 1,
        })
        .eq("id", existing.id);
      if (error) {
        throw new Error(`PublicOrderingService.upsertCustomer: ${error.message}`);
      }
      return existing.id;
    }

    const { data: created, error: createError } = await this.supabase
      .from("order_customers")
      .insert({
        tenant_id: tenantId,
        name,
        mobile_number: mobileNumber,
        default_delivery_location: deliveryLocation,
        first_order_at: nowIso,
        last_order_at: nowIso,
        order_count: 1,
      })
      .select("id")
      .single();

    if (createError || !created) {
      // Extremely rare race: two submissions with the same brand-new
      // mobile number landed concurrently. The unique constraint
      // rejects the loser; re-select and treat it the same as the
      // "existing" branch above rather than failing the whole order.
      const { data: raceWinner } = await this.supabase
        .from("order_customers")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("mobile_number", mobileNumber)
        .single();
      if (raceWinner) {
        return raceWinner.id;
      }
      throw new Error(`PublicOrderingService.upsertCustomer: ${createError?.message ?? "could not create or find customer"}`);
    }

    return created.id;
  }
}

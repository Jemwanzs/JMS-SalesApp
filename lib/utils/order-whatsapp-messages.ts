import type { OrderStatus } from "@/types/database.types";

export interface OrderWhatsAppMessageContext {
  customerName: string;
  orderNumber: string | null;
  outletName: string;
  orderTotal: number;
  deliveryLocation: string;
}

const DEFAULT_ON_DELIVERY_TEMPLATE =
  "Hello {customerName}, your order #{orderNumber} from {outletName} is now on delivery. Order Value: {orderTotal}. Delivering to: {deliveryLocation}.";
const DEFAULT_COMPLETED_TEMPLATE =
  "Hello {customerName}, your order #{orderNumber} has been completed. Thank you for ordering from {outletName}. We appreciate your business and look forward to serving you again.";

function fillTemplate(template: string, ctx: OrderWhatsAppMessageContext): string {
  return template
    .replaceAll("{customerName}", ctx.customerName)
    .replaceAll("{orderNumber}", ctx.orderNumber ?? "")
    .replaceAll("{outletName}", ctx.outletName)
    .replaceAll("{orderTotal}", ctx.orderTotal.toFixed(2))
    .replaceAll("{deliveryLocation}", ctx.deliveryLocation);
}

/**
 * received/being_attended stay simple and non-configurable this phase
 * -- the spec's own language ("can later support contextual pre-filled
 * messages") treats those as a future nice-to-have, not a requirement.
 * on_delivery/completed mirror the spec's own worked examples (sections
 * 2 and 16) and accept a tenant override (WhatsAppMessagesCard's
 * whatsapp_message_on_delivery/whatsapp_message_completed settings) --
 * pass the override in, null/undefined falls back to the default here.
 */
export function buildOrderWhatsAppMessage(
  status: OrderStatus,
  ctx: OrderWhatsAppMessageContext,
  overrides: { onDeliveryTemplate?: string | null; completedTemplate?: string | null } = {}
): string {
  switch (status) {
    case "received":
      return fillTemplate("Hello {customerName}, we've received your order #{orderNumber}. Thank you for ordering from {outletName}!", ctx);
    case "being_attended":
      return fillTemplate("Hello {customerName}, your order #{orderNumber} is being prepared by {outletName}.", ctx);
    case "on_delivery":
      return fillTemplate(overrides.onDeliveryTemplate || DEFAULT_ON_DELIVERY_TEMPLATE, ctx);
    case "completed":
      return fillTemplate(overrides.completedTemplate || DEFAULT_COMPLETED_TEMPLATE, ctx);
    case "cancelled":
    case "rejected":
      return fillTemplate("Hello {customerName}, regarding your order #{orderNumber} with {outletName} -- ", ctx);
  }
}

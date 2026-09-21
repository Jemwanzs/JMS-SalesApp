import { Badge } from "@/components/ui/badge";
import type { OrderStatus } from "@/types/database.types";

const STATUS_VARIANT: Record<OrderStatus, "default" | "secondary" | "destructive" | "outline"> = {
  received: "secondary",
  being_attended: "outline",
  on_delivery: "default",
  completed: "default",
  cancelled: "destructive",
  rejected: "destructive",
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  received: "Received",
  being_attended: "Being Attended",
  on_delivery: "On Delivery",
  completed: "Completed",
  cancelled: "Cancelled",
  rejected: "Rejected",
};

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <Badge
      variant={STATUS_VARIANT[status]}
      className={status === "completed" ? `bg-green-600 text-white hover:bg-green-600 ${className ?? ""}` : className}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export { STATUS_LABEL as ORDER_STATUS_LABEL };

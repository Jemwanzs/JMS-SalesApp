import { Badge } from "@/components/ui/badge";
import type { PaymentView } from "@/services/BillingService";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  success: "default",
  pending: "secondary",
  failed: "destructive",
};

export function PaymentHistoryList({ payments }: { payments: PaymentView[] }) {
  if (payments.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">No payments yet.</p>
      </div>
    );
  }

  return (
    <div className="divide-y rounded-lg border">
      {payments.map((payment) => (
        <div key={payment.id} className="flex items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-medium">
              {payment.currency} {payment.amount.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(payment.paidAt ?? payment.createdAt).toLocaleString()}
            </p>
          </div>
          <Badge variant={STATUS_VARIANT[payment.status] ?? "secondary"}>{payment.status}</Badge>
        </div>
      ))}
    </div>
  );
}

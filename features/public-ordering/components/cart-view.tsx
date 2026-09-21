"use client";

import { ArrowLeft, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CartLine } from "@/features/public-ordering/components/ordering-storefront";

/** Line items + remove + total + Continue, mirroring ExpenseSplitRows' own repeatable-rows-with-total shape. */
export function CartView({
  cart,
  onRemove,
  onBack,
  onContinue,
}: {
  cart: CartLine[];
  onRemove: (orderProductId: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const total = cart.reduce((sum, l) => sum + l.requestedAmount, 0);

  return (
    <div className="flex flex-1 flex-col p-6">
      <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>
      <h2 className="mb-4 text-lg font-semibold">Your Order</h2>

      {cart.length === 0 ? (
        <p className="text-sm text-muted-foreground">Your cart is empty.</p>
      ) : (
        <div className="space-y-3">
          {cart.map((line) => (
            <div key={line.orderProductId} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{line.productName}</p>
                <p className="text-sm text-muted-foreground">{line.requestedAmount.toFixed(2)}</p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(line.orderProductId)}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${line.productName}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}

          <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
            <span className="font-medium">Order Total</span>
            <span className="font-semibold tabular-nums">{total.toFixed(2)}</span>
          </div>

          <Button type="button" className="w-full" onClick={onContinue}>
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}

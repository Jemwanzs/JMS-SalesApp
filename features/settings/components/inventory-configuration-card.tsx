"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setStockControlMethodAction } from "@/features/settings/actions/set-stock-control-method";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

/**
 * Tenant-wide policy (docs/21-inventory-management.md), replacing what
 * used to be a per-product setting -- a business tracks its stock by
 * value or by count as one coherent choice, not product-by-product.
 * Selecting Quantity locks the Quantity field card's toggle ON
 * (quantity-field-card.tsx's own `locked` prop) since it becomes
 * mandatory for tracked products; selecting Monetary Value (the
 * default) leaves that toggle a free preference again.
 */
export function InventoryConfigurationCard({
  tenantId,
  tenantSlug,
  initialMethod,
}: {
  tenantId: string;
  tenantSlug: string;
  initialMethod: "quantity" | "value";
}) {
  const [method, setMethod] = useState(initialMethod);
  const [isPending, startTransition] = useTransition();

  function onSelect(next: "quantity" | "value") {
    if (next === method) return;
    const previous = method;
    setMethod(next);
    startTransition(async () => {
      const result = await setStockControlMethodAction(tenantId, tenantSlug, next);
      if (result.error) {
        setMethod(previous);
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventory Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Label className="font-normal text-muted-foreground">Record stock by</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={method === "value" ? "default" : "outline"}
            onClick={() => onSelect("value")}
            disabled={isPending}
            className="flex-1"
          >
            Monetary Value
          </Button>
          <Button
            type="button"
            size="sm"
            variant={method === "quantity" ? "default" : "outline"}
            onClick={() => onSelect("quantity")}
            disabled={isPending}
            className="flex-1"
          >
            QTY
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {method === "value"
            ? "Stock is tracked and reconciled by value (e.g. opening stock worth KES 5,000, reduced by sales value through the day). The Quantity field below stays optional."
            : "Stock is tracked and reconciled by counted units. Quantity becomes required when recording a sale of a tracked product, and the Quantity field below is locked on."}
        </p>
      </CardContent>
    </Card>
  );
}

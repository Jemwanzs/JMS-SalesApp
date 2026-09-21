"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CartLine } from "@/features/public-ordering/components/ordering-storefront";
import type { StorefrontProduct } from "@/services/PublicOrderingService";

/**
 * Tap a product -> enter the amount you'd like -> Add to Cart, same
 * "tap a row, small dialog, one confirm action" idiom RecordSaleDialog
 * already establishes for the tenant app's own Record Sale flow. Client-
 * side minimum-order validation is immediate UX only -- the real check
 * happens again server-side in PublicOrderingService.submitOrder
 * against the product's CURRENT minimum, never trusted from here.
 */
export function ProductOrderDialog({
  product,
  existingLine,
  onOpenChange,
  onAdd,
}: {
  product: StorefrontProduct | null;
  existingLine: CartLine | null;
  onOpenChange: (open: boolean) => void;
  onAdd: (line: CartLine) => void;
}) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (product) {
      setAmount(existingLine ? String(existingLine.requestedAmount) : "");
      setError(null);
    }
  }, [product, existingLine]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    const numericAmount = Number(amount);
    if (!amount || Number.isNaN(numericAmount) || numericAmount <= 0) {
      setError("Enter an amount");
      return;
    }
    if (numericAmount < product.minimumOrderAmount) {
      setError(`Minimum order for this product is ${product.minimumOrderAmount.toFixed(2)}.`);
      return;
    }
    onAdd({
      orderProductId: product.id,
      productName: product.name,
      imageUrl: product.imageUrl,
      minimumOrderAmount: product.minimumOrderAmount,
      requestedAmount: numericAmount,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={product !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {product && (
          <>
            <DialogHeader>
              <DialogTitle>{product.name}</DialogTitle>
              <DialogDescription>Minimum order: {product.minimumOrderAmount.toFixed(2)}</DialogDescription>
            </DialogHeader>

            {product.imageUrl && (
              <div className="mx-auto h-32 w-32 overflow-hidden rounded-lg">
                <Image src={product.imageUrl} alt="" width={128} height={128} className="h-full w-full object-cover" />
              </div>
            )}
            {product.description && <p className="text-center text-sm text-muted-foreground">{product.description}</p>}

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="order-amount">How much would you like?</Label>
                <Input
                  id="order-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <DialogFooter>
                <Button type="submit" className="w-full">
                  {existingLine ? "Update Cart" : "Add to Cart"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

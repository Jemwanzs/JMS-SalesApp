"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

import { CartView } from "@/features/public-ordering/components/cart-view";
import { DeliveryDetailsForm, type DeliveryDetails } from "@/features/public-ordering/components/delivery-details-form";
import { OrderConfirmationSummary } from "@/features/public-ordering/components/order-confirmation-summary";
import { OrderSuccessScreen } from "@/features/public-ordering/components/order-success-screen";
import { ProductList } from "@/features/public-ordering/components/product-list";
import type { Storefront } from "@/services/PublicOrderingService";
import type { SubmitOrderResult } from "@/services/PublicOrderingService";

export interface CartLine {
  orderProductId: string;
  productName: string;
  imageUrl: string | null;
  minimumOrderAmount: number;
  requestedAmount: number;
}

type Step = "browse" | "cart" | "delivery" | "confirm" | "success";

/**
 * Owns the ENTIRE customer flow on ONE route -- browse -> cart ->
 * delivery details -> confirm -> success -- as client-side step state,
 * matching this app's own established "no intermediate navigation"
 * idiom (RecordSaleDialog's tap-product -> enter-amount -> confirm ->
 * back-to-capture flow, just for a public multi-step checkout instead
 * of one dialog). Cart + delivery details + the idempotency key all
 * persist to sessionStorage, keyed by tenant slug, so a refresh mid-
 * flow doesn't lose progress (spec: "cart should persist during the
 * customer's current ordering session") -- cleared only after a
 * successful submission.
 */
export function OrderingStorefront({ storefront }: { storefront: Storefront }) {
  const cartKey = `orders-cart:${storefront.tenantSlug}`;
  const deliveryKey = `orders-delivery:${storefront.tenantSlug}`;
  const idempotencyKeyStorageKey = `orders-idempotency:${storefront.tenantSlug}`;

  const [step, setStep] = useState<Step>("browse");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [delivery, setDelivery] = useState<DeliveryDetails | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [successResult, setSuccessResult] = useState<SubmitOrderResult | null>(null);

  // Restore from sessionStorage on mount -- client-only, so this
  // deliberately runs in an effect rather than useState's initializer
  // (avoids a server/client render mismatch, sessionStorage doesn't
  // exist during SSR).
  useEffect(() => {
    try {
      const savedCart = sessionStorage.getItem(cartKey);
      if (savedCart) setCart(JSON.parse(savedCart));
      const savedDelivery = sessionStorage.getItem(deliveryKey);
      if (savedDelivery) setDelivery(JSON.parse(savedDelivery));
      const savedKey = sessionStorage.getItem(idempotencyKeyStorageKey);
      setIdempotencyKey(savedKey || crypto.randomUUID());
    } catch {
      setIdempotencyKey(crypto.randomUUID());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(cartKey, JSON.stringify(cart));
    } catch {
      // sessionStorage can throw in private-browsing contexts -- the
      // cart still works for this page view, it just won't survive a
      // refresh; not worth surfacing an error for.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart]);

  useEffect(() => {
    if (!idempotencyKey) return;
    try {
      sessionStorage.setItem(idempotencyKeyStorageKey, idempotencyKey);
    } catch {
      // See cart effect's own comment above.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idempotencyKey]);

  function addToCart(line: CartLine) {
    setCart((prev) => {
      const existingIndex = prev.findIndex((l) => l.orderProductId === line.orderProductId);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = line;
        return next;
      }
      return [...prev, line];
    });
  }

  function removeFromCart(orderProductId: string) {
    setCart((prev) => prev.filter((l) => l.orderProductId !== orderProductId));
  }

  function onOrderSuccess(result: SubmitOrderResult) {
    setSuccessResult(result);
    setStep("success");
    setCart([]);
    setDelivery(null);
    try {
      sessionStorage.removeItem(cartKey);
      sessionStorage.removeItem(deliveryKey);
      sessionStorage.removeItem(idempotencyKeyStorageKey);
    } catch {
      // Non-fatal -- see effects above.
    }
    setIdempotencyKey(crypto.randomUUID());
  }

  const cartTotal = cart.reduce((sum, l) => sum + l.requestedAmount, 0);

  if (step === "success" && successResult) {
    return <OrderSuccessScreen storefront={storefront} result={successResult} />;
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="space-y-2 border-b p-6 text-center">
        {storefront.logoUrl && (
          <div className="mx-auto h-16 w-16 overflow-hidden rounded-lg">
            <Image src={storefront.logoUrl} alt="" width={64} height={64} className="h-full w-full object-cover" />
          </div>
        )}
        <h1 className="text-xl font-semibold">{storefront.outletName}</h1>
        <p className="text-sm text-muted-foreground">{storefront.welcomeMessage || "Order directly from us. Your order will be attended to promptly by our team."}</p>
      </header>

      {step === "browse" && (
        <ProductList
          products={storefront.products}
          cart={cart}
          onAddToCart={addToCart}
          cartCount={cart.length}
          cartTotal={cartTotal}
          onViewCart={() => setStep("cart")}
        />
      )}

      {step === "cart" && (
        <CartView
          cart={cart}
          onRemove={removeFromCart}
          onBack={() => setStep("browse")}
          onContinue={() => setStep("delivery")}
        />
      )}

      {step === "delivery" && (
        <DeliveryDetailsForm
          initial={delivery}
          deliveryFeeNotice={storefront.deliveryFeeNotice}
          onBack={() => setStep("cart")}
          onContinue={(details) => {
            setDelivery(details);
            try {
              sessionStorage.setItem(deliveryKey, JSON.stringify(details));
            } catch {
              // Non-fatal.
            }
            setStep("confirm");
          }}
        />
      )}

      {step === "confirm" && delivery && (
        <OrderConfirmationSummary
          storefront={storefront}
          cart={cart}
          delivery={delivery}
          idempotencyKey={idempotencyKey}
          onBack={() => setStep("delivery")}
          onSuccess={onOrderSuccess}
        />
      )}
    </div>
  );
}

"use client";

import type { ExpensePaymentMethod } from "@/services/ExpensePaymentMethodService";

/**
 * Deliberately a plain native <select>, not a combobox -- payment-method
 * lists are short (Cash/Mobile Money/Card/Bank...) and don't need search,
 * so there's no reason to reintroduce any popover-shaped risk for a case
 * that doesn't call for it (see ExpenseItemCombobox's own header comment
 * on why comboboxes here stay inline rather than floating).
 */
export function ExpensePaymentMethodSelect({
  paymentMethods,
  value,
  onChange,
  id,
}: {
  paymentMethods: ExpensePaymentMethod[];
  value: string;
  onChange: (id: string) => void;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <option value="" disabled>
        Select payment method
      </option>
      {paymentMethods.map((pm) => (
        <option key={pm.id} value={pm.id}>
          {pm.name}
        </option>
      ))}
    </select>
  );
}

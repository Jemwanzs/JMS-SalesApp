export type CustomerTier = "gold" | "silver" | "bronze";

const TIER_ORDER: CustomerTier[] = ["gold", "silver", "bronze"];

/**
 * Same top-3-by-array-index convention as lib/utils/product-ranking.ts's
 * rankProducts() -- sorts by completed-order value (highest first),
 * assigns the top 3 with value > 0 a Gold/Silver/Bronze tier, a
 * customer with zero completed-order value never gets one even if
 * fewer than 3 customers have any. `rank` is the plain 1-based
 * position (1 = top customer, matching `tier === "gold"` whenever a
 * tier exists at all); kept as its own field rather than derived from
 * `tier` because the five-star "top customer" badge (spec section 7)
 * is conceptually distinct from the Gold tier itself -- always exactly
 * one customer, never zero or more than one, even in a tie (stable
 * sort keeps the first-encountered customer as rank 1).
 */
export function rankCustomers<T extends { id: string }>(
  customers: T[],
  completedValueByCustomerId: Map<string, number>
): (T & { tier: CustomerTier | null; rank: number; completedValue: number; isTopCustomer: boolean })[] {
  return [...customers]
    .map((customer) => ({
      ...customer,
      completedValue: completedValueByCustomerId.get(customer.id) ?? 0,
    }))
    .sort((a, b) => b.completedValue - a.completedValue)
    .map((customer, index) => ({
      ...customer,
      tier: customer.completedValue > 0 ? (TIER_ORDER[index] ?? null) : null,
      rank: index + 1,
      isTopCustomer: index === 0 && customer.completedValue > 0,
    }));
}

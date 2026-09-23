import type { CustomerTier } from "@/lib/utils/customer-ranking";

const TIER_MEDAL: Record<CustomerTier, string> = {
  gold: "🥇",
  silver: "🥈",
  bronze: "🥉",
};

const TIER_LABEL: Record<CustomerTier, string> = {
  gold: "Gold Customer",
  silver: "Silver Customer",
  bronze: "Bronze Customer",
};

/**
 * The medal + label pairing from the spec's own worked examples
 * (section 6). Renders nothing for a customer with no tier (ranked
 * below 3rd, or zero completed-order value) -- `tier` is already null
 * in that case, this component just reflects it rather than deciding.
 */
export function CustomerTierBadge({ tier, className }: { tier: CustomerTier | null; className?: string }) {
  if (!tier) return null;
  return (
    <span className={className}>
      {TIER_MEDAL[tier]} {TIER_LABEL[tier]}
    </span>
  );
}

/** Five gold stars -- spec section 7, exactly one customer (rank #1) ever gets this. */
export function TopCustomerStars({ className }: { className?: string }) {
  return (
    <span className={className} aria-label="Top Customer" title="Top Customer">
      ★★★★★
    </span>
  );
}

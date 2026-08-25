/**
 * Fixed, code-level UOM catalog (Product Enhancements #5) -- a closed,
 * product-level labeling concern, so no DB table for it (see migration
 * 0035's header comment). "Custom Unit" isn't in this list -- it's a
 * separate escape hatch: `products.unit_of_measure_is_custom = true`
 * stores the tenant's own free-typed label verbatim instead of a code
 * from here.
 */
export interface UomCategory {
  category: string;
  units: string[];
}

export const UOM_CATEGORIES: UomCategory[] = [
  {
    category: "Count",
    units: [
      "pcs",
      "units",
      "items",
      "pairs",
      "sets",
      "packs",
      "packets",
      "sachets",
      "boxes",
      "cartons",
      "cases",
      "crates",
      "dozens",
      "rolls",
      "bundles",
      "bags",
      "sacks",
      "trays",
      "bottles",
      "cans",
      "tins",
      "jars",
      "tubes",
    ],
  },
  { category: "Weight", units: ["mg", "g", "kg", "t"] },
  { category: "Volume", units: ["ml", "L", "m³"] },
  { category: "Length/Area", units: ["mm", "cm", "m", "km", "m²"] },
  { category: "Other", units: ["sheets", "reams", "tablets", "capsules", "servings", "portions"] },
];

export const ALL_UOM_CODES: string[] = UOM_CATEGORIES.flatMap((c) => c.units);

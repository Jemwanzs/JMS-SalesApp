export interface TourStep {
  id: string;
  /** null = stays on whatever page the user is currently on. */
  route: (tenantSlug: string) => string | null;
  /**
   * Tried in order; the first one present in the DOM wins. Only the
   * "sale" step actually needs two (open-day button vs. the first
   * product's record-sale button) -- every other step has exactly one.
   */
  anchorSelectors: string[] | null;
  titleKey: string;
  bodyKey: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    route: () => null,
    anchorSelectors: null,
    titleKey: "welcomeTitle",
    bodyKey: "welcomeBody",
  },
  {
    id: "business",
    route: (slug) => `/t/${slug}/workspace`,
    anchorSelectors: ['[data-tour-id="workspace-business-profile"]'],
    titleKey: "businessTitle",
    bodyKey: "businessBody",
  },
  {
    id: "branch",
    route: (slug) => `/t/${slug}/settings`,
    anchorSelectors: ['[data-tour-id="add-branch-button"]'],
    titleKey: "branchTitle",
    bodyKey: "branchBody",
  },
  {
    id: "products",
    route: (slug) => `/t/${slug}/products`,
    anchorSelectors: ['[data-tour-id="add-product-form"]'],
    titleKey: "productsTitle",
    bodyKey: "productsBody",
  },
  {
    id: "sale",
    route: (slug) => `/t/${slug}/sales`,
    anchorSelectors: ['[data-tour-id="tour-open-day-button"]', '[data-tour-id="record-sale-target"]'],
    titleKey: "saleTitle",
    bodyKey: "saleBody",
  },
  {
    id: "stock",
    route: () => null,
    anchorSelectors: ['[data-tour-id="tour-nav-stock"]'],
    titleKey: "stockTitle",
    bodyKey: "stockBody",
  },
  {
    id: "analytics",
    route: () => null,
    anchorSelectors: ['[data-tour-id="tour-nav-analytics"]'],
    titleKey: "analyticsTitle",
    bodyKey: "analyticsBody",
  },
  {
    id: "reports",
    route: () => null,
    anchorSelectors: ['[data-tour-id="tour-nav-reports"]'],
    titleKey: "reportsTitle",
    bodyKey: "reportsBody",
  },
  {
    id: "finish",
    route: () => null,
    anchorSelectors: null,
    titleKey: "finishTitle",
    bodyKey: "finishBody",
  },
];

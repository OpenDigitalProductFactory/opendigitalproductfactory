/**
 * The four portfolios' two spellings, in one place.
 *
 * `Workroom.portfolioRole` (and the area rail) uses the camelCase role; the
 * `Portfolio` table and the budget read models use the registry slug.
 */
export const PORTFOLIO_ROLES = ["productsAndServicesSold", "manufactureAndDeliver", "forEmployees", "foundational"] as const;
export type PortfolioRoleKey = (typeof PORTFOLIO_ROLES)[number];

/** Workroom.portfolioRole → Portfolio.slug. */
export const PORTFOLIO_SLUG_BY_ROLE: Record<PortfolioRoleKey, string> = {
  foundational: "foundational",
  manufactureAndDeliver: "manufacturing_and_delivery",
  forEmployees: "for_employees",
  productsAndServicesSold: "products_and_services_sold",
};

export function isPortfolioRole(value: unknown): value is PortfolioRoleKey {
  return typeof value === "string" && (PORTFOLIO_ROLES as readonly string[]).includes(value);
}

export const OWNER_FACING_AREAS = [
  {
    key: "products_and_services_sold",
    label: "Customers and sales",
    order: 1,
  },
  {
    key: "for_employees",
    label: "Your team",
    order: 2,
  },
  {
    key: "manufacturing_and_delivery",
    label: "Operations and delivery",
    order: 3,
  },
  {
    key: "foundational",
    label: "Platform and back office",
    order: 4,
  },
] as const;

export type OwnerFacingAreaKey =
  | (typeof OWNER_FACING_AREAS)[number]["key"]
  | "other";

export type OwnerFacingArea = {
  key: OwnerFacingAreaKey;
  label: string;
  order: number;
};

export const OTHER_OWNER_FACING_AREA: OwnerFacingArea = {
  key: "other",
  label: "Other",
  order: 5,
};

const AREA_BY_PORTFOLIO = new Map<string, OwnerFacingArea>(
  OWNER_FACING_AREAS.map((area) => [area.key, area]),
);

export function ownerFacingAreaForPortfolio(
  portfolioSlug: string | null | undefined,
): OwnerFacingArea {
  return (
    (portfolioSlug ? AREA_BY_PORTFOLIO.get(portfolioSlug) : undefined) ??
    OTHER_OWNER_FACING_AREA
  );
}

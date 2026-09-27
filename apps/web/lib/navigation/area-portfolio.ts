// The four FPAW portfolio keys as Workroom.portfolioRole spells them
// (WorkPortfolioRole in work-coordination.prisma). Kept as a plain union here so
// the navigation model stays free of database imports; area-portfolio.test.ts
// asserts it matches the Prisma enum.
export const WORK_PORTFOLIO_ROLE_KEYS = [
  "foundational",
  "manufactureAndDeliver",
  "forEmployees",
  "productsAndServicesSold",
] as const;

export type WorkPortfolioRoleKey = (typeof WORK_PORTFOLIO_ROLE_KEYS)[number];

import type { WorkPortfolioRoleKey } from "./area-portfolio";

export type PortalShellSectionKey =
  | "workspace"
  | "business"
  | "team"
  | "delivery"
  | "platform"
  | "knowledge";

export interface PortalShellSectionDefinition {
  key: PortalShellSectionKey;
  label: string;
  description: string;
  /**
   * The FPAW portfolio this rail section is traceable to (spec
   * 2026-08-14-portfolio-shaped-information-architecture-design.md §4.1, §9).
   * `null` marks an honest cross-cut ("my work", reference) rather than a
   * pretend domain. A portfolio section is also a workroom-shaped area with
   * Work, Team and Setup views at /area/[key].
   */
  portfolioRole: WorkPortfolioRoleKey | null;
}

// Labels name the activity; the portfolio key is the traceable model
// (WWMD DI-3CAD53D55BC5). Keys stay stable so persisted nav-mode cookies,
// tests and record sectionKeys keep resolving.
export const PORTAL_SHELL_SECTIONS: readonly PortalShellSectionDefinition[] = [
  { key: "workspace", label: "Today", description: "What needs you now and the work in motion.", portfolioRole: null },
  { key: "business", label: "Serve & grow", description: "Customers, supporters, funding and compliance.", portfolioRole: "productsAndServicesSold" },
  { key: "team", label: "Team", description: "The people and AI coworkers who do the work, and how they decide.", portfolioRole: "forEmployees" },
  { key: "delivery", label: "Improve & deliver", description: "Requests, builds and releases for what you offer.", portfolioRole: "manufactureAndDeliver" },
  { key: "platform", label: "Run the platform", description: "Access, connections, updates and audit for the whole install.", portfolioRole: "foundational" },
  { key: "knowledge", label: "Learn", description: "Architecture, knowledge and guides.", portfolioRole: null },
];

/** Portfolio sections are the workroom-shaped areas; cross-cuts are not. */
export const AREA_SECTIONS = PORTAL_SHELL_SECTIONS.filter(
  (section): section is PortalShellSectionDefinition & { portfolioRole: WorkPortfolioRoleKey } =>
    section.portfolioRole !== null,
);

export function areaHref(key: PortalShellSectionKey, view?: "work" | "team" | "setup"): string {
  return view && view !== "work" ? `/area/${key}?view=${view}` : `/area/${key}`;
}

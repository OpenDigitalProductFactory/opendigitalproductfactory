// apps/web/lib/docs-types.ts
// Shared types and constants for the docs system.
// Safe for both server and client — no Node fs/path imports.

// ── Types ────────────────────────────────────────────────────────────────────

export type DocPage = {
  slug: string;           // e.g. "getting-started/index"
  title: string;
  area: string;           // e.g. "getting-started"
  order: number;
  lastUpdated: string;    // ISO date string
  updatedBy: string;
  content: string;        // markdown body (no frontmatter)
  relatedSpecs: string[];
  roles: string[];
};

export type DocHeading = {
  level: number;
  text: string;
  slug: string;
};

export type DocsIndex = Record<string, DocPage[]>;

// ── Area metadata (display names + descriptions for the docs home) ──────────

export const AREA_META: Record<string, { label: string; description: string }> = {
  "getting-started": { label: "Getting Started", description: "Platform overview, roles, navigation, and AI coworker basics" },
  workspace:         { label: "Workspace", description: "Dashboard, calendar, activity feed, and notifications" },
  portfolios:        { label: "Portfolios", description: "Portfolio structure, health metrics, and investment tracking" },
  products:          { label: "Products", description: "Digital product registry, lifecycle stages, and taxonomy" },
  architecture:      { label: "Architecture", description: "EA canvas, viewpoints, reference models, and value streams" },
  hr:                { label: "HR & Workforce", description: "Employee directory, lifecycle, reviews, and org chart" },
  customers:         { label: "Customers", description: "CRM accounts, contacts, pipeline, quotes, and orders" },
  compliance:        { label: "Compliance", description: "Regulations, obligations, controls, evidence, and policies" },
  finance:           { label: "Finance", description: "Invoicing, accounts payable, purchase orders, and suppliers" },
  storefront:        { label: "Storefront", description: "Public-facing storefront setup, sections, items, and booking" },
  "build-studio":    { label: "Build Studio", description: "Product development: ideate, plan, build, review, ship" },
  operations:        { label: "Operations", description: "Backlog items, epics, and delivery management" },
  "ai-workforce":    { label: "AI Workforce", description: "AI providers, model routing, and agent capabilities" },
  admin:             { label: "Admin", description: "Users, roles, branding, reference data, and settings" },
};

// Ordered area keys for display (Getting Started first, Admin last)
export const AREA_ORDER = Object.keys(AREA_META);

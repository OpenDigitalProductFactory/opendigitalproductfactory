import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_FAMILIES } from "@/components/admin/admin-nav";
import { getShellNavSections } from "@/lib/govern/permissions";

import { WORK_PORTFOLIO_ROLE_KEYS } from "./area-portfolio";
import { PORTAL_NAV_ROUTES, getAreaSetupEntries, getRouteNavRecord } from "./portal-navigation-model";
import { AREA_SECTIONS, PORTAL_SHELL_SECTIONS, areaHref } from "./portal-shell-sections";

// EP-2FB6C0CC — spec 2026-08-14-portfolio-shaped-information-architecture-design.md §9.
// AC-AREA-SPINE, AC-AREA-SETUP.

const WEB_ROOT = join(__dirname, "..", "..");
const superuser = { platformRole: null, isSuperuser: true } as const;

function pageFileExists(path: string): boolean {
  return existsSync(join(WEB_ROOT, "app", "(shell)", ...path.split("/").filter(Boolean), "page.tsx"));
}

describe("portfolio-shaped rail (AC-AREA-SPINE)", () => {
  it("traces every rail section to one FPAW portfolio or a declared cross-cut", () => {
    const portfolios = PORTAL_SHELL_SECTIONS.flatMap((section) => (section.portfolioRole ? [section.portfolioRole] : []));
    expect([...portfolios].sort()).toEqual([...WORK_PORTFOLIO_ROLE_KEYS].sort());
    expect(PORTAL_SHELL_SECTIONS.filter((section) => section.portfolioRole === null).map((s) => s.key)).toEqual([
      "workspace",
      "knowledge",
    ]);
  });

  it("puts every rail entry in a declared section", () => {
    const keys = new Set(PORTAL_SHELL_SECTIONS.map((section) => section.key));
    for (const route of PORTAL_NAV_ROUTES) {
      if (route.shellNav) expect(keys.has(route.shellNav.sectionKey), route.path).toBe(true);
    }
  });

  it("keeps the Full-mode rail at 18 entries or fewer", () => {
    const entries = getShellNavSections(superuser, { mode: "operator" }).flatMap((section) => section.items);
    expect(entries.length).toBeLessThanOrEqual(18);
  });

  it("gives each portfolio section an area home with a nav record", () => {
    for (const section of AREA_SECTIONS) {
      const record = getRouteNavRecord(areaHref(section.key));
      expect(record?.label, section.key).toBe(section.label);
    }
    expect(pageFileExists("/area/[key]")).toBe(true);
  });

  it("keeps rail labels and breadcrumb labels the same record label", () => {
    for (const route of PORTAL_NAV_ROUTES) {
      if (route.shellNav) expect(route.shellNav.label ?? route.label, route.path).toBe(route.label);
    }
  });
});

// Admin pages that are review or catalog screens, not settings. Each has a reason.
const NOT_SETTINGS: Record<string, string> = {
  "/admin/hive": "reviews outbound contributions; nothing reads it as configuration",
  "/admin/issue-reports": "reads filed issue reports",
  "/admin/cockpit": "read-only install diagnostics",
  "/admin/graph-explorer": "read-only graph browser",
  "/admin/business-models": "no runtime reader (resolveBmrAuthority has no callers); pending BI-595245CC",
  "/admin/archetypes": "read-only archetype catalog; the archetype is chosen in storefront setup",
};

describe("each setting has one home (AC-AREA-SETUP)", () => {
  it("assigns every settings record to exactly one area whose page exists", () => {
    const setup = PORTAL_NAV_ROUTES.filter((route) => route.setupFor);
    expect(setup.length).toBeGreaterThan(0);
    for (const route of setup) {
      expect(PORTAL_SHELL_SECTIONS.some((section) => section.key === route.setupFor), route.path).toBe(true);
      if (!route.path.includes("[")) expect(pageFileExists(route.path), route.path).toBe(true);
    }
    for (const route of PORTAL_NAV_ROUTES.filter((r) => r.destinationKind === "settings")) {
      expect(route.setupFor, `${route.path} is a settings page with no area`).toBeDefined();
    }
  });

  it("gives every Admin page an area Setup home or a stated reason it is not a setting", () => {
    const setupPaths = new Set(AREA_SECTIONS.flatMap((section) => getAreaSetupEntries(section.key).map((e) => e.path)));
    const adminPages = [...new Set(ADMIN_FAMILIES.flatMap((family) => family.subItems.map((item) => item.href)))];
    for (const href of adminPages) {
      expect(setupPaths.has(href) || href in NOT_SETTINGS, `${href} has no area and no reason`).toBe(true);
    }
  });

  it("homes Contributing & GitHub with delivery work, where it is read", () => {
    expect(getAreaSetupEntries("delivery").map((entry) => [entry.label, entry.path])).toContainEqual([
      "Contributing & GitHub",
      "/admin/platform-development",
    ]);
  });
});

describe("portfolio role keys", () => {
  it("match the WorkPortfolioRole enum in the schema", () => {
    const schema = readFileSync(
      join(WEB_ROOT, "..", "..", "packages", "db", "prisma", "schema", "work-coordination.prisma"),
      "utf8",
    );
    const body = schema.match(/enum WorkPortfolioRole \{([^}]*)\}/)?.[1] ?? "";
    const members = body.split(/\s+/).filter(Boolean);
    expect([...members].sort()).toEqual([...WORK_PORTFOLIO_ROLE_KEYS].sort());
  });
});

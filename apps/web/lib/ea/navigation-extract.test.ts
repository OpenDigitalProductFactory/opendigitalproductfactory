import { describe, expect, it } from "vitest";

import {
  buildNavigationModel,
  buildDomainResolver,
  toNavEntries,
  NAVIGATION_PACKAGE_KEY,
  type NavSourceEntry,
} from "./navigation-extract";
import { PORTAL_NAV_ROUTES } from "../navigation/portal-navigation-model";

const ENTRIES: NavSourceEntry[] = [
  { key: "platform", label: "Platform Hub", path: "/platform", domain: "platform", targetDomain: "platform" },
  { key: "ai_workforce", label: "AI Workforce", path: "/platform/ai", domain: "platform", targetDomain: "platform" },
  { key: "finance", label: "Finance", path: "/finance", domain: "business", targetDomain: "business" },
];

describe("buildNavigationModel", () => {
  const model = buildNavigationModel({
    entries: ENTRIES,
    routePaths: ["/platform", "/platform/ai", "/finance", "/complaints", "/widgets/[id]"],
  });

  it("projects a Navigation package with one surface per entry domain", () => {
    expect(model.elements.find((e) => e.sysmlKey === NAVIGATION_PACKAGE_KEY)?.typeSlug).toBe("package");
    const surfaces = model.elements.filter((e) => e.sysmlKey.startsWith("navigation:surface:")).map((e) => e.sysmlKey);
    expect(surfaces.sort()).toEqual(["navigation:surface:business", "navigation:surface:platform"]);
  });

  it("emits an entry part_usage contained by its domain surface", () => {
    const entry = model.elements.find((e) => e.sysmlKey === "navigation:entry:ai_workforce");
    expect(entry?.typeSlug).toBe("part_usage");
    expect(model.relationships).toContainEqual({
      fromKey: "navigation:surface:platform",
      toKey: "navigation:entry:ai_workforce",
      relSlug: "contains",
    });
  });

  it("links each entry to the route surface via a cross-layer traces (navigates-to) edge", () => {
    expect(model.crossLayerRelationships).toContainEqual({
      fromKey: "navigation:entry:platform",
      toKey: "route:/platform",
      relSlug: "traces",
    });
    expect(model.relTypeSlugs).toContain("traces");
  });

  it("flags real routes with no canonical nav entry as an orphan conformance finding, excluding dynamic routes", () => {
    const orphan = model.conformanceIssues?.find((c) => c.issueType === "route-not-in-canonical-nav");
    expect(orphan?.onKey).toBe(NAVIGATION_PACKAGE_KEY);
    expect(orphan?.message).toContain("/complaints");
    // dynamic route excluded; the three nav targets are covered
    expect(orphan?.message).not.toContain("/widgets/[id]");
    expect(orphan?.message).toMatch(/^1 route/);
  });

  it("does not file an orphan finding when every route has a nav entry", () => {
    const clean = buildNavigationModel({ entries: ENTRIES, routePaths: ["/platform", "/finance"] });
    expect(clean.conformanceIssues?.some((c) => c.issueType === "route-not-in-canonical-nav")).toBe(false);
  });

  it("flags a cross-domain teleport on the offending entry", () => {
    const m = buildNavigationModel({
      entries: [{ key: "coreAdmin", label: "Core Admin", path: "/admin", domain: "platform", targetDomain: "admin" }],
      routePaths: ["/admin"],
    });
    const teleport = m.conformanceIssues?.find((c) => c.issueType === "nav-entry-crosses-domain");
    expect(teleport?.onKey).toBe("navigation:entry:coreAdmin");
    expect(teleport?.severity).toBe("high");
  });

  it("excludes routes owned by not-yet-projected per-domain navs from the orphan set", () => {
    const m = buildNavigationModel({
      entries: ENTRIES,
      routePaths: ["/platform", "/finance", "/finance/invoices", "/compliance/risks"],
      unprojectedNavDomains: ["finance", "compliance"],
    });
    expect(m.conformanceIssues?.some((c) => c.issueType === "route-not-in-canonical-nav")).toBe(false);
  });

  it("soft-removes under the navigation: prefix and scopes its own view", () => {
    expect(model.softRemovePrefix).toBe("navigation:");
    expect(model.view.scopeRef).toBe("navigation");
    expect(model.elementTypeSlugs).toEqual(["package", "part_definition", "part_usage"]);
  });
});

describe("buildDomainResolver", () => {
  const resolve = buildDomainResolver([
    { path: "/platform", domain: "platform" },
    { path: "/platform/ai", domain: "platform" },
    { path: "/finance", domain: "business" },
  ]);

  it("matches the longest path prefix", () => {
    expect(resolve("/platform/ai/providers", "x")).toBe("platform");
    expect(resolve("/finance/invoices", "x")).toBe("business");
  });

  it("falls back when no canonical ancestor matches (no false positive)", () => {
    expect(resolve("/unknown", "fallback-domain")).toBe("fallback-domain");
  });
});

describe("toNavEntries (canonical model normalization)", () => {
  const entries = toNavEntries(PORTAL_NAV_ROUTES);

  it("drops legacy-redirect records and keeps real destinations", () => {
    expect(entries.some((e) => e.path === "/admin/storefront")).toBe(false); // legacy-redirect
    expect(entries.some((e) => e.key === "platform" && e.path === "/platform")).toBe(true);
  });

  it("produces no cross-domain teleports from the canonical model (it is clean by construction)", () => {
    expect(entries.filter((e) => e.domain !== e.targetDomain)).toEqual([]);
  });
});

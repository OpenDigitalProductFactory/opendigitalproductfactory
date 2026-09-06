import { describe, expect, it } from "vitest";

import {
  buildNavigationModel,
  buildDomainResolver,
  toNavEntries,
  resolveEffectivePath,
  NAVIGATION_PACKAGE_KEY,
  type NavSourceEntry,
} from "./navigation-extract";
import { PORTAL_NAV_ROUTES, type PortalNavRecord } from "../navigation/portal-navigation-model";

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

  it("emits interaction-shape metadata when supplied by the shape extractor", () => {
    const m = buildNavigationModel({
      entries: [{
        key: "marketing_delegate",
        label: "Ask marketing coworker",
        path: "/customer/marketing",
        domain: "business",
        targetDomain: "business",
        jobLane: "owner-marketing",
        stepRole: "delegate",
        continuesTo: ["coworker-marketing"],
        spineStage: "market-and-sell",
      }],
      routePaths: ["/customer/marketing"],
    });

    const entry = m.elements.find((e) => e.sysmlKey === "navigation:entry:marketing_delegate");
    expect(entry?.properties).toMatchObject({
      jobLane: "owner-marketing",
      stepRole: "delegate",
      continuesTo: ["coworker-marketing"],
      spineStage: "market-and-sell",
    });
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

  it("flags a redirect-disguised teleport as a distinct finding (href in-domain, redirects out)", () => {
    const m = buildNavigationModel({
      entries: [{
        key: "capNeeds",
        label: "Capability Needs",
        path: "/platform/ai/capability-needs",
        domain: "platform",
        targetDomain: "delivery",
        effectivePath: "/ops",
        viaRedirect: true,
      }],
      routePaths: [],
    });
    const f = m.conformanceIssues?.find((c) => c.issueType === "nav-entry-redirects-cross-domain");
    expect(f?.onKey).toBe("navigation:entry:capNeeds");
    expect(f?.severity).toBe("high");
    expect(f?.message).toContain("/ops");
    expect(f?.message).toContain("REDIRECTS");
    // It is the redirect flavour, NOT also the plain href teleport (no double-count).
    expect(m.conformanceIssues?.some((c) => c.issueType === "nav-entry-crosses-domain")).toBe(false);
    // The entry element records the redirect for the canvas.
    const entry = m.elements.find((e) => e.sysmlKey === "navigation:entry:capNeeds");
    expect(entry?.properties?.viaRedirect).toBe(true);
    expect(entry?.properties?.effectivePath).toBe("/ops");
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

  it("resolves the EFFECTIVE target domain through a redirect shim when a redirect map is supplied", () => {
    const records: PortalNavRecord[] = [
      { key: "k", label: "Cap Needs", path: "/platform/ai/capability-needs", parentPath: "/platform/ai", domain: "platform", audienceModes: ["operator"], destinationKind: "section-page", capabilityKey: "view_platform" },
      { key: "ops", label: "Backlog", path: "/ops", parentPath: "/", domain: "delivery", audienceModes: ["operator"], destinationKind: "domain-home", capabilityKey: "view_operations" },
    ];
    const out = toNavEntries(records, new Map([["/platform/ai/capability-needs", "/ops"]]));
    const cap = out.find((e) => e.key === "k");
    expect(cap?.viaRedirect).toBe(true);
    expect(cap?.effectivePath).toBe("/ops");
    expect(cap?.targetDomain).toBe("delivery"); // resolved from the redirect destination, not the href
  });
});

describe("resolveEffectivePath", () => {
  it("follows a redirect chain to the final route and strips the query", () => {
    const map = new Map([["/a", "/b?x=1"], ["/b", "/c"]]);
    expect(resolveEffectivePath("/a", map)).toEqual({ path: "/c", viaRedirect: true });
  });

  it("returns the path unchanged when it is not a shim", () => {
    expect(resolveEffectivePath("/platform", new Map())).toEqual({ path: "/platform", viaRedirect: false });
  });

  it("terminates on a redirect cycle (no infinite loop)", () => {
    const r = resolveEffectivePath("/a", new Map([["/a", "/b"], ["/b", "/a"]]));
    expect(r.viaRedirect).toBe(true);
    expect(["/a", "/b"]).toContain(r.path);
  });
});

import { describe, it, expect } from "vitest";
import {
  ROUTE_CONTEXT_MAP,
  FALLBACK_ROUTE_CONTEXT,
  resolveRouteContext,
} from "./route-context-map";

describe("resolveRouteContext", () => {
  it("matches exact route prefix", () => {
    const ctx = resolveRouteContext("/portfolio");
    expect(ctx.domain).toBe("Portfolio Management");
    expect(ctx.routePrefix).toBe("/portfolio");
  });

  it("matches nested routes (e.g., /build/FB-123 -> Build Studio)", () => {
    const ctx = resolveRouteContext("/build/FB-123");
    expect(ctx.domain).toBe("Build Studio");
    expect(ctx.routePrefix).toBe("/build");
  });

  it("uses the confidential Change Review context for governed work capsules", () => {
    const ctx = resolveRouteContext("/build/work/WC-123");

    expect(ctx.domain).toBe("Change Review");
    expect(ctx.routePrefix).toBe("/build/work");
    expect(ctx.sensitivity).toBe("confidential");
    expect(ctx.domainTools).toEqual(
      expect.arrayContaining(["read_project_file", "search_code_graph", "find_related_tests"]),
    );
  });

  it("matches nested EA routes", () => {
    const ctx = resolveRouteContext("/ea/views/123");
    expect(ctx.domain).toBe("Enterprise Architecture");
  });

  it("matches discovery operations routes ahead of the generic platform context", () => {
    const ctx = resolveRouteContext("/platform/tools/discovery");
    expect(ctx.domain).toBe("Discovery Operations");
    expect(ctx.routePrefix).toBe("/platform/tools/discovery");
    expect(ctx.domainTools).toContain("summarize_estate_posture");
  });

  it("matches product estate routes ahead of the broader portfolio context", () => {
    const ctx = resolveRouteContext("/portfolio/product/prod-123/inventory");
    expect(ctx.domain).toBe("Products");
    expect(ctx.routePrefix).toBe("/portfolio/product");
    expect(ctx.domainTools).toContain("review_estate_identity");
    expect(ctx.domainTools).toContain("explain_blast_radius");
    expect(ctx.domainTools).toContain("create_product_objective");
    expect(ctx.domainTools).toContain("record_product_outcome_observation");
  });

  it("falls back to workspace for unknown routes", () => {
    const ctx = resolveRouteContext("/unknown/path");
    expect(ctx.domain).toBe("Workspace");
    expect(ctx.routePrefix).toBe(FALLBACK_ROUTE_CONTEXT.routePrefix);
    expect(ctx.sensitivity).toBe(FALLBACK_ROUTE_CONTEXT.sensitivity);
  });

  it("falls back to workspace for root path", () => {
    const ctx = resolveRouteContext("/");
    expect(ctx.domain).toBe("Workspace");
  });

  it("returns correct sensitivity for /admin (restricted)", () => {
    const ctx = resolveRouteContext("/admin");
    expect(ctx.sensitivity).toBe("restricted");
  });

  it("uses a specialist context for admin issue reports", () => {
    const ctx = resolveRouteContext("/admin/issue-reports");

    expect(ctx.domain).toBe("Admin Issue Triage");
    expect(ctx.routePrefix).toBe("/admin/issue-reports");
    expect(ctx.sensitivity).toBe("restricted");
    expect(ctx.domainTools).toEqual(expect.arrayContaining([
      "admin_view_logs",
      "admin_query_db",
      "admin_read_file",
      "create_backlog_item",
      "update_backlog_item",
    ]));
    expect(ctx.skills.some((skill) => skill.label === "Triage issue reports")).toBe(true);
    expect(ctx.skills.some((skill) => skill.label === "Suppress warmup noise")).toBe(true);
  });

  it("returns correct sensitivity for /employee (confidential)", () => {
    const ctx = resolveRouteContext("/employee");
    expect(ctx.sensitivity).toBe("confidential");
  });

  it("returns correct sensitivity for /portfolio (internal)", () => {
    const ctx = resolveRouteContext("/portfolio");
    expect(ctx.sensitivity).toBe("internal");
  });

  it("keeps Performance owner-focused and refuses to imply connected metrics", () => {
    const ctx = resolveRouteContext("/performance");

    expect(ctx.domain).toBe("Business Performance");
    expect(ctx.routePrefix).toBe("/performance");
    expect(ctx.sensitivity).toBe("confidential");
    expect(ctx.domainContext).toContain("historical");
    expect(ctx.domainContext).toContain("must not invent");
    expect(ctx.domainTools).toEqual([]);
  });

  it("returns correct sensitivity for /customer (confidential)", () => {
    const ctx = resolveRouteContext("/customer");
    expect(ctx.sensitivity).toBe("confidential");
  });

  it("matches customer marketing routes ahead of the broader customer context", () => {
    const ctx = resolveRouteContext("/customer/marketing/strategy");
    expect(ctx.domain).toBe("Customer Marketing");
    expect(ctx.routePrefix).toBe("/customer/marketing");
    expect(ctx.domainTools).toContain("get_marketing_summary");
    expect(ctx.domainTools).toContain("suggest_campaign_ideas");
  });

  it("returns route-aware docs for finance leaf routes", () => {
    const ctx = resolveRouteContext("/finance/banking/acc-123/reconcile");
    expect(ctx.docsPath).toBe("/docs/finance/banking-and-reconciliation");
  });

  it("routes finance pages to a confidential finance context with the period summary tool", () => {
    const ctx = resolveRouteContext("/finance/reports/profit-loss");

    expect(ctx.domain).toBe("Finance Operations");
    expect(ctx.routePrefix).toBe("/finance");
    expect(ctx.sensitivity).toBe("confidential");
    expect(ctx.domainTools).toContain("get_finance_period_summary");
    expect(ctx.domainTools).toEqual(expect.arrayContaining([
      "mcp-browser-use__browse_open",
      "mcp-browser-use__browse_act",
      "mcp-browser-use__browse_extract",
      "mcp-browser-use__browse_screenshot",
      "mcp-browser-use__browse_close",
    ]));
    expect(ctx.skills.some((skill) => skill.label === "Income vs expenses this month")).toBe(true);
    expect(ctx.skills.some((skill) => skill.label === "Retrieve billing portal costs")).toBe(true);
  });

  it("matches licensing routes ahead of the broader compliance context", () => {
    const ctx = resolveRouteContext("/compliance/licensing");
    expect(ctx.domain).toBe("Licensing & Permit Readiness");
    expect(ctx.routePrefix).toBe("/compliance/licensing");
    expect(ctx.domainTools).toContain("save_licensing_investigation");
    expect(ctx.domainTools).toContain("create_licensing_readiness_issue");
  });

  it("returns route-aware docs for platform provider routes", () => {
    const ctx = resolveRouteContext("/platform/ai/providers/provider-123");
    expect(ctx.docsPath).toBe("/docs/ai-workforce/connecting-providers");
  });

  it("returns route-aware docs for storefront settings leaf routes", () => {
    const ctx = resolveRouteContext("/storefront/settings/business");
    expect(ctx.docsPath).toBe("/docs/storefront/settings-business-and-operations");
  });

  it("returns correct sensitivity for /platform (confidential)", () => {
    const ctx = resolveRouteContext("/platform");
    expect(ctx.sensitivity).toBe("confidential");
  });
});

describe("ROUTE_CONTEXT_MAP", () => {
  const allRoutes = Object.keys(ROUTE_CONTEXT_MAP);

  it("has entries for all expected routes", () => {
    const expected = [
      "/portfolio",
      "/portfolio/product",
      "/inventory",
      "/platform/tools/discovery",
      "/ea",
      "/employee",
      "/customer",
      "/customer/marketing",
      "/compliance/licensing",
      "/finance",
      "/storefront",
      "/ops",
      "/build",
      "/platform",
      "/admin",
      "/admin/issue-reports",
      "/workspace",
    ];
    for (const route of expected) {
      expect(ROUTE_CONTEXT_MAP[route]).toBeDefined();
    }
  });

  it("every entry has a non-empty domainContext", () => {
    for (const route of allRoutes) {
      const def = ROUTE_CONTEXT_MAP[route]!;
      expect(def.domainContext.length).toBeGreaterThan(0);
    }
  });

  it('every entry includes a "Report an issue" skill with capability null', () => {
    for (const route of allRoutes) {
      const def = ROUTE_CONTEXT_MAP[route]!;
      const reportSkill = def.skills.find((s) => s.label === "Report an issue");
      expect(reportSkill).toBeDefined();
      expect(reportSkill!.capability).toBeNull();
    }
  });

  it("sensitive routes mention data classification in domainContext", () => {
    const sensitiveRoutes = [
      "/employee",
      "/customer",
      "/platform",
      "/admin",
      "/workspace",
    ];
    for (const route of sensitiveRoutes) {
      const def = ROUTE_CONTEXT_MAP[route]!;
      expect(def.domainContext).toMatch(/classified as (confidential|restricted)/);
    }
  });

  it("routePrefix matches the map key for every entry", () => {
    for (const [key, def] of Object.entries(ROUTE_CONTEXT_MAP)) {
      expect(def.routePrefix).toBe(key);
    }
  });

  it("keeps discovery sweep gated behind provider-management capability", () => {
    const aliasRoute = ROUTE_CONTEXT_MAP["/inventory"]!;
    const discoveryRoute = ROUTE_CONTEXT_MAP["/platform/tools/discovery"]!;
    const aliasSkill = aliasRoute.skills.find((skill) => skill.label === "Run discovery sweep");
    const discoverySkill = discoveryRoute.skills.find((skill) => skill.label === "Run discovery sweep");

    expect(aliasRoute.domain).toBe("Discovery Operations");
    expect(aliasSkill?.capability).toBe("manage_provider_connections");
    expect(discoverySkill?.capability).toBe("manage_provider_connections");
  });

  it("exposes identity review skills on estate routes", () => {
    const productRoute = ROUTE_CONTEXT_MAP["/portfolio/product"]!;
    const discoveryRoute = ROUTE_CONTEXT_MAP["/platform/tools/discovery"]!;

    expect(productRoute.domainTools).toContain("review_estate_identity");
    expect(discoveryRoute.domainTools).toContain("review_estate_identity");
    expect(productRoute.skills.some((skill) => skill.label === "Review item identity")).toBe(true);
    expect(discoveryRoute.skills.some((skill) => skill.label === "Review item identity")).toBe(true);
  });

  it("keeps the storefront context focused on portal operations instead of marketing strategy", () => {
    const storefrontRoute = ROUTE_CONTEXT_MAP["/storefront"]!;
    expect(storefrontRoute.domain).toBe("Storefront Operations");
    expect(storefrontRoute.domainTools).not.toContain("get_marketing_summary");
    expect(storefrontRoute.domainTools).not.toContain("suggest_campaign_ideas");
  });

  it("keeps licensing investigation skills on the licensing route instead of the generic compliance route", () => {
    const licensingRoute = ROUTE_CONTEXT_MAP["/compliance/licensing"]!;
    const complianceRoute = ROUTE_CONTEXT_MAP["/compliance"]!;

    expect(licensingRoute.skills.some((skill) => skill.label === "Investigate licensing footprint")).toBe(true);
    expect(complianceRoute.skills.some((skill) => skill.label === "Investigate licensing footprint")).toBe(false);
  });
});

describe("FALLBACK_ROUTE_CONTEXT", () => {
  it("is the /workspace entry", () => {
    expect(FALLBACK_ROUTE_CONTEXT).toBe(ROUTE_CONTEXT_MAP["/workspace"]);
    expect(FALLBACK_ROUTE_CONTEXT.domain).toBe("Workspace");
  });
});

describe("ROUTE_CONTEXT_MAP /build operator-contract tooling", () => {
  // Build specialist operator contract clause 2.6 requires the build-specialist
  // to be able to call report_quality_issue when it detects a genuine process
  // issue. Spec: docs/superpowers/specs/2026-04-30-build-specialist-operator-contract.md §2.6
  it("delivers report_quality_issue so the build-specialist can log process issues", () => {
    const buildRoute = ROUTE_CONTEXT_MAP["/build"];
    expect(buildRoute).toBeDefined();
    expect(buildRoute!.domainTools).toContain("report_quality_issue");
  });

  it("still delivers the core build-lifecycle tools used by the operator contract", () => {
    const buildRoute = ROUTE_CONTEXT_MAP["/build"];
    const required = ["saveBuildEvidence", "reviewDesignDoc", "reviewBuildPlan"];
    for (const tool of required) {
      expect(buildRoute!.domainTools).toContain(tool);
    }
  });

  it("exposes code graph tools for build impact research", () => {
    const buildRoute = ROUTE_CONTEXT_MAP["/build"];

    expect(buildRoute!.domainTools).toContain("get_code_graph_freshness");
    expect(buildRoute!.domainTools).toContain("inspect_build_code_impact");
    expect(buildRoute!.domainTools).toContain("search_code_graph");
    expect(buildRoute!.domainTools).toContain("trace_code_surface");
    expect(buildRoute!.domainTools).toContain("find_related_tests");
  });
});

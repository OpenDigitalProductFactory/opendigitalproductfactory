import { describe, expect, it } from "vitest";
import {
  buildContextualDocsHref,
  getMappedDocsRoutes,
  resolveDocsExposurePolicy,
  resolveDocsPath,
  shouldShowDocsLink,
} from "./docs-route-map";
import { docsPathExists } from "./docs-route-map.server";

describe("resolveDocsPath", () => {
  it("maps finance banking leaf routes to a workflow-specific doc", () => {
    expect(resolveDocsPath("/finance/banking/acc-123/reconcile")).toBe("/docs/finance/banking-and-reconciliation");
  });

  it("maps platform provider routes to the provider setup doc", () => {
    expect(resolveDocsPath("/platform/ai/providers/provider-123")).toBe("/docs/ai-workforce/connecting-providers");
  });

  it("maps compliance evidence routes to controls and evidence docs", () => {
    expect(resolveDocsPath("/compliance/evidence/EV-001")).toBe("/docs/compliance/controls-and-evidence");
  });

  it("maps storefront settings leaf routes to the settings workflow doc", () => {
    expect(resolveDocsPath("/storefront/settings/business")).toBe("/docs/storefront/settings-business-and-operations");
  });

  it("maps setup to a setup-specific getting-started doc", () => {
    expect(resolveDocsPath("/setup")).toBe("/docs/getting-started/setup-and-first-login");
  });

  it("maps recently added shell surfaces to current operational docs", () => {
    expect(resolveDocsPath("/workspace/documents/DOC-001")).toBe("/docs/workspace/documents");
    expect(resolveDocsPath("/wiki/entities/digital-product")).toBe("/docs/wiki/index");
    expect(resolveDocsPath("/platform/edge-nodes")).toBe("/docs/platform/edge-nodes");
    expect(resolveDocsPath("/platform/ai/operations-map")).toBe("/docs/platform/ai-operations");
    expect(resolveDocsPath("/platform/ai/capacity-continuity")).toBe("/docs/platform/ai-operations");
    expect(resolveDocsPath("/platform/ai/capability-needs")).toBe("/docs/platform/ai-operations");
    expect(resolveDocsPath("/compliance/licensing")).toBe("/docs/compliance/licensing-readiness");
    expect(resolveDocsPath("/platform/tools/integrations/google-business-profile")).toBe(
      "/docs/platform/tools-and-integrations",
    );
  });
});

describe("docs exposure policy", () => {
  it("shows internal docs links for internal shell workflows", () => {
    expect(resolveDocsExposurePolicy("/finance/reports/cash-flow")).toBe("visible");
    expect(shouldShowDocsLink("/finance/reports/cash-flow")).toBe(true);
    expect(buildContextualDocsHref("/finance/reports/cash-flow")).toBe(
      "/docs/finance/reporting-and-close?sourceRoute=%2Ffinance%2Freports%2Fcash-flow",
    );
  });

  it("keeps auth routes focused by hiding internal docs", () => {
    expect(resolveDocsExposurePolicy("/login")).toBe("hidden");
    expect(shouldShowDocsLink("/login")).toBe(false);
    expect(buildContextualDocsHref("/login")).toBeNull();
  });

  it("does not expose internal docs on public storefront routes", () => {
    expect(resolveDocsExposurePolicy("/s/acme/checkout")).toBe("hidden");
    expect(shouldShowDocsLink("/s/acme/checkout")).toBe(false);
    expect(buildContextualDocsHref("/s/acme/checkout")).toBeNull();
  });

  it("does not expose internal docs on customer portal routes", () => {
    expect(resolveDocsExposurePolicy("/portal/orders")).toBe("hidden");
    expect(shouldShowDocsLink("/portal/orders")).toBe(false);
  });
});

describe("mapped docs pages", () => {
  it("keeps every mapped docs path backed by an actual docs page", () => {
    for (const entry of getMappedDocsRoutes()) {
      expect(
        docsPathExists(entry.docsPath),
        `Missing docs page for ${entry.routePrefix}: ${entry.docsPath}`,
      ).toBe(true);
    }
  });

  it("keeps high-signal visible workflow routes backed by existing docs pages", () => {
    const visibleRouteDocsExamples = [
      "/workspace/documents",
      "/wiki",
      "/platform/edge-nodes",
      "/platform/ai/operations-map",
      "/platform/ai/capacity-continuity",
      "/platform/ai/capability-needs",
      "/compliance/licensing",
      "/finance/settings/tax",
    ];

    for (const pathname of visibleRouteDocsExamples) {
      expect(shouldShowDocsLink(pathname), `${pathname} should expose contextual docs`).toBe(true);
      const docsPath = resolveDocsPath(pathname);
      expect(docsPath, `${pathname} should resolve to a docs path`).not.toBeNull();
      expect(docsPathExists(docsPath!), `${pathname} maps to missing docs page ${docsPath}`).toBe(true);
    }
  });
});

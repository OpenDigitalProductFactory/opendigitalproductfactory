import { describe, expect, it } from "vitest";

import {
  buildArchitectureDrillthrough,
  inspectRoutingDecision,
  inspectArchitectureSource,
} from "./architecture-drillthrough";

describe("buildArchitectureDrillthrough", () => {
  it("derives deterministic cross-notation view links from existing relationships", () => {
    const drillthrough = buildArchitectureDrillthrough({
      currentViewId: "view-bpmn",
      selectedElementIds: ["bpmn-rank"],
      elements: [
        {
          id: "bpmn-rank",
          name: "Balance quality, time, and cost",
          notationSlug: "bpmn20",
          properties: { registryKey: "rank-quality-time-cost" },
        },
        {
          id: "arch-router",
          name: "Route Selector and Fallback",
          notationSlug: "archimate4",
          properties: {},
        },
        {
          id: "sysml-router",
          name: "Route Selector",
          notationSlug: "sysml2",
          properties: {},
        },
        {
          id: "sysml-requirement",
          name: "REQ-AIC-1 Eligible-set routing",
          notationSlug: "sysml2",
          properties: {},
        },
        {
          id: "sysml-verification",
          name: "VC-AIC-ELIGIBILITY hard route exclusions",
          notationSlug: "sysml2",
          properties: {},
        },
      ],
      relationships: [
        {
          fromElementId: "arch-router",
          toElementId: "bpmn-rank",
          relationshipLabel: "Realizes process",
        },
        {
          fromElementId: "sysml-router",
          toElementId: "arch-router",
          relationshipLabel: "Allocates",
        },
        {
          fromElementId: "sysml-router",
          toElementId: "sysml-requirement",
          relationshipLabel: "Satisfies",
        },
        {
          fromElementId: "sysml-verification",
          toElementId: "sysml-requirement",
          relationshipLabel: "Verifies",
        },
      ],
      memberships: [
        {
          elementId: "bpmn-rank",
          viewId: "view-bpmn",
          viewName: "AI Routing — Designed Process",
          notationSlug: "bpmn20",
          notationName: "BPMN 2.0",
        },
        {
          elementId: "arch-router",
          viewId: "view-arch",
          viewName: "AI Routing — Realizing Architecture",
          notationSlug: "archimate4",
          notationName: "ArchiMate 4",
        },
        {
          elementId: "sysml-router",
          viewId: "view-sysml",
          viewName: "AI Cockpit — Requirements & Verification",
          notationSlug: "sysml2",
          notationName: "SysML 2",
        },
        {
          elementId: "sysml-requirement",
          viewId: "view-sysml",
          viewName: "AI Cockpit — Requirements & Verification",
          notationSlug: "sysml2",
          notationName: "SysML 2",
        },
        {
          elementId: "sysml-verification",
          viewId: "view-sysml",
          viewName: "AI Cockpit — Requirements & Verification",
          notationSlug: "sysml2",
          notationName: "SysML 2",
        },
      ],
    });

    expect(drillthrough["bpmn-rank"]?.relatedViews).toEqual([
      expect.objectContaining({
        viewId: "view-arch",
        elementId: "arch-router",
        notationSlug: "archimate4",
        distance: 1,
        href: "/ea/views/view-arch?element=arch-router",
      }),
      expect.objectContaining({
        viewId: "view-sysml",
        elementId: "sysml-router",
        notationSlug: "sysml2",
        distance: 2,
        href: "/ea/views/view-sysml?element=sysml-router",
      }),
      expect.objectContaining({
        viewId: "view-sysml",
        elementId: "sysml-requirement",
        notationSlug: "sysml2",
        distance: 3,
      }),
      expect.objectContaining({
        viewId: "view-sysml",
        elementId: "sysml-verification",
        notationSlug: "sysml2",
        distance: 4,
      }),
    ]);
    expect(drillthrough["bpmn-rank"]?.operationsMapHref).toBe(
      "/platform/ai/operations-map?mode=compare&focus=rank-quality-time-cost",
    );
  });

  it("uses the shortest path and stable notation/view ordering", () => {
    const drillthrough = buildArchitectureDrillthrough({
      currentViewId: "current",
      selectedElementIds: ["a"],
      elements: [
        { id: "a", name: "A", notationSlug: "bpmn20", properties: {} },
        { id: "b", name: "B", notationSlug: "sysml2", properties: {} },
        { id: "c", name: "C", notationSlug: "archimate4", properties: {} },
      ],
      relationships: [
        { fromElementId: "a", toElementId: "b", relationshipLabel: "Traces" },
        { fromElementId: "a", toElementId: "c", relationshipLabel: "Realizes" },
        { fromElementId: "c", toElementId: "b", relationshipLabel: "Allocates" },
      ],
      memberships: [
        {
          elementId: "a",
          viewId: "current",
          viewName: "Current",
          notationSlug: "bpmn20",
          notationName: "BPMN",
        },
        {
          elementId: "b",
          viewId: "view-sysml",
          viewName: "SysML",
          notationSlug: "sysml2",
          notationName: "SysML",
        },
        {
          elementId: "c",
          viewId: "view-arch",
          viewName: "ArchiMate",
          notationSlug: "archimate4",
          notationName: "ArchiMate",
        },
      ],
    });

    expect(drillthrough.a?.relatedViews.map((link) => [link.notationSlug, link.distance])).toEqual([
      ["archimate4", 1],
      ["sysml2", 1],
    ]);
  });

  it("links the same canonical element when it belongs to another view", () => {
    const drillthrough = buildArchitectureDrillthrough({
      currentViewId: "view-a",
      selectedElementIds: ["shared"],
      elements: [
        { id: "shared", name: "Governed AI Routing", notationSlug: "archimate4", properties: {} },
      ],
      relationships: [],
      memberships: [
        {
          elementId: "shared",
          viewId: "view-a",
          viewName: "Capability view",
          notationSlug: "archimate4",
          notationName: "ArchiMate 4",
        },
        {
          elementId: "shared",
          viewId: "view-b",
          viewName: "Portfolio view",
          notationSlug: "archimate4",
          notationName: "ArchiMate 4",
        },
      ],
    });

    expect(drillthrough.shared?.relatedViews).toEqual([
      expect.objectContaining({
        viewId: "view-b",
        elementId: "shared",
        distance: 0,
        relationshipPath: ["Same architecture element"],
      }),
    ]);
  });
});

describe("inspectRoutingDecision", () => {
  it("exposes only governed safe inputs, bounded outcomes, provenance, and freshness", () => {
    expect(
      inspectRoutingDecision({
        properties: {
          registryKey: "data-policy-gateway",
          sourceKey:
            "apps/web/lib/inference/data-screening/evaluate-inference-policy.ts#evaluateInferenceDispatchPolicy",
          sourceVersion: "ai-routing/v1",
          implementationStatus: "partial",
          prompt: "must never be reflected",
        },
        latestEvidenceAt: "2026-07-27T02:00:00.000Z",
      }),
    ).toEqual({
      title: "What did data policy decide?",
      technicalName: "Allow, protect, review, or deny gateway",
      safeInputs: ["Data classes", "Purpose", "Actor and governed assets", "Route boundary"],
      outcomes: ["Allow", "Allow after protection", "Review", "Deny"],
      sourcePath: "apps/web/lib/inference/data-screening/evaluate-inference-policy.ts",
      sourceSymbol: "evaluateInferenceDispatchPolicy",
      sourceVersion: "ai-routing/v1",
      implementationStatus: "partial",
      latestEvidenceAt: "2026-07-27T02:00:00.000Z",
    });
  });

  it("returns null for a non-decision station", () => {
    expect(
      inspectRoutingDecision({
        properties: { registryKey: "dispatch" },
        latestEvidenceAt: null,
      }),
    ).toBeNull();
  });
});


describe("inspectArchitectureSource reference classification", () => {
  it.each([
    "it4it:value_stream:value_stream__evaluate",
    "urn:dpf:architecture:evaluate",
    "https://example.invalid/reference",
    "javascript:alert(1)",
    "../outside.ts",
    "/etc/passwd",
    "C:\\source\\example.ts",
    "unresolved",
  ])("keeps %s as a reference without a repository-file link", (sourceKey) => {
    expect(inspectArchitectureSource({ sourceKey })).toEqual({
      path: sourceKey,
      symbol: null,
      version: null,
      implementationStatus: null,
      href: null,
    });
  });

  it("preserves repository paths, symbols and source metadata", () => {
    expect(inspectArchitectureSource({
      sourceKey: "apps/web/lib/ea/architecture-drillthrough.ts#inspectArchitectureSource",
      sourceVersion: "routing/v1",
      implementationStatus: "implemented",
    })).toEqual({
      path: "apps/web/lib/ea/architecture-drillthrough.ts",
      symbol: "inspectArchitectureSource",
      version: "routing/v1",
      implementationStatus: "implemented",
      href: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/ea/architecture-drillthrough.ts",
    });
  });

  it("preserves extensionless repository file references", () => {
    expect(inspectArchitectureSource({ sourceKey: "Dockerfile" })?.href)
      .toBe("https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/Dockerfile");
  });

  it.each([undefined, null, "", "  ", 42])("retains absent-source behavior for %s", (sourceKey) => {
    expect(inspectArchitectureSource({ sourceKey })).toBeNull();
  });
});

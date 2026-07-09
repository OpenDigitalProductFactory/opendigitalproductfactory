// Overlay-state tests for the "Optimization Impact" capability overlay
// (BI-D9B58004): a capability lights up when a linked backlog item belongs to
// the EP-8DC217EB consolidation-bet registry.

import { describe, expect, it } from "vitest";

import type { BusinessCapabilityNode } from "./data";
import { deriveCapabilityOverlayState } from "./view-model";

function makeNode(
  backlogLinks: Array<{ label: string; status: "open" | "in-progress" | "done" | null }>,
): BusinessCapabilityNode {
  return {
    id: "cap-1",
    capabilityId: "CAP-1",
    name: "Test Capability",
    slug: "test-capability",
    description: null,
    level: 2,
    sortOrder: 0,
    status: "active",
    parentId: null,
    currentMaturity: 2,
    targetMaturity: 3,
    maturityRationale: null,
    it4itValueStreams: [],
    traceLinks: [],
    children: [],
    maturityGap: 1,
    maturityBand: "watch",
    traceGroups: {
      taxonomy_node: [],
      digital_product: [],
      backlog_item: backlogLinks.map((link, index) => ({
        id: `trace-${index}`,
        targetType: "backlog_item" as const,
        relationship: "impacted_by",
        note: null,
        label: link.label,
        href: null,
        status: link.status,
      })),
      ea_element: [],
    },
  };
}

describe("optimization overlay mode", () => {
  it("marks a capability active when a linked bet backlog item is in flight", () => {
    // BI-B6157FB7 is BET-10's live backlog item in the registry.
    const node = makeNode([{ label: "BI-B6157FB7 Build one live health/run read-model", status: "open" }]);
    const state = deriveCapabilityOverlayState(node, "optimization");
    expect(state.tone).toBe("active");
    expect(state.shortLabel).toBe("1 bet");
  });

  it("marks a capability covered when its bet links are all completed", () => {
    const node = makeNode([{ label: "BI-3B0AD9CF Consolidate per-PR CI ratchet aggregators", status: "done" }]);
    const state = deriveCapabilityOverlayState(node, "optimization");
    expect(state.tone).toBe("covered");
  });

  it("stays neutral for backlog links outside the bet registry", () => {
    const node = makeNode([{ label: "BI-00000000 Unrelated work", status: "open" }]);
    const state = deriveCapabilityOverlayState(node, "optimization");
    expect(state.tone).toBe("neutral");
    expect(state.sortWeight).toBe(0);
  });

  it("stays neutral with no backlog links at all", () => {
    const state = deriveCapabilityOverlayState(makeNode([]), "optimization");
    expect(state.tone).toBe("neutral");
  });
});

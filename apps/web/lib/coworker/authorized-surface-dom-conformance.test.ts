// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import type { SemanticSurfaceGraph, SurfaceDefinition } from "@dpf/types";

import { compareAuthorizedSurfaceToDom } from "./authorized-surface-dom-conformance";

const definition: SurfaceDefinition = {
  contractVersion: "1.0",
  surfaceId: "test.surface",
  label: "Test",
  purpose: "Test DOM evidence",
  supportedModes: ["browser"],
  entryPoints: [{ kind: "route", pattern: "/test" }],
  loaderId: "test.loader",
  nodes: [
    { nodeId: "form", kind: "form", accessibleName: "Form", valuePolicy: "none", sensitivity: "internal" },
    { nodeId: "field", parentId: "form", kind: "field", accessibleName: "Name", valuePolicy: "read", sensitivity: "internal" },
    { nodeId: "derived", parentId: "form", kind: "field", accessibleName: "Derived", valuePolicy: "read", sensitivity: "internal", rendered: false },
  ],
  actions: [],
};

function graph(): SemanticSurfaceGraph {
  return {
    contractVersion: "1.0", surfaceId: "test.surface", revision: "r1", generatedAt: new Date(0).toISOString(),
    summary: { label: "Test", purpose: "Test" }, actions: [], continuations: [],
    provenance: { source: "test.loader", trust: "trusted-system", sensitivity: "internal" },
    nodes: definition.nodes.map((node) => ({
      nodeId: node.nodeId, kind: node.kind, accessibleName: node.accessibleName,
      parentId: node.parentId,
      provenance: { source: "test.loader", trust: "trusted-system", sensitivity: node.sensitivity },
    })),
  };
}

describe("Authorized Surface DOM/AX conformance", () => {
  it("passes mapped accessible controls and ignores declared semantic-only nodes", () => {
    document.body.innerHTML = `<div data-surface-node-id="form"><label>Name<input data-surface-node-id="field"></label></div>`;
    expect(compareAuthorizedSurfaceToDom({ definition, graph: graph(), root: document.body })).toEqual({
      ok: true, missingRenderedNodeIds: [], duplicateNodeIds: [], unmappedControlDescriptions: [], inaccessibleNodeIds: [],
    });
  });

  it("reports missing, duplicate, unmapped, and inaccessible rendered controls", () => {
    document.body.innerHTML = `<div data-surface-node-id="form"></div><div data-surface-node-id="form"></div><button>Extra</button><input data-surface-node-id="field">`;
    const result = compareAuthorizedSurfaceToDom({ definition, graph: graph(), root: document.body });
    expect(result).toMatchObject({
      ok: false,
      duplicateNodeIds: ["form"],
      unmappedControlDescriptions: ["button:Extra"],
      inaccessibleNodeIds: ["field"],
    });
  });
});

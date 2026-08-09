import type { SemanticSurfaceGraph, SurfaceDefinition } from "@dpf/types";

export type SurfaceDomConformanceResult = {
  ok: boolean;
  missingRenderedNodeIds: string[];
  duplicateNodeIds: string[];
  unmappedControlDescriptions: string[];
  inaccessibleNodeIds: string[];
};

const CONTROL_SELECTOR = "button,input,select,textarea,a[href],[role='button'],[role='checkbox'],[role='combobox']";

function accessibleText(element: Element): string {
  const aria = element.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "").join(" ").trim();
    if (text) return text;
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    const text = Array.from(element.labels ?? []).map((label) => label.textContent ?? "").join(" ").trim();
    if (text) return text;
  }
  return element.textContent?.trim() ?? "";
}

/**
 * Browser/AX evidence adapter. It verifies that a rendered implementation is
 * a projection of the compiled graph; it never discovers authority or creates
 * actions from DOM content.
 */
export function compareAuthorizedSurfaceToDom(input: {
  definition: SurfaceDefinition;
  graph: SemanticSurfaceGraph;
  root: ParentNode;
}): SurfaceDomConformanceResult {
  const elements = [...input.root.querySelectorAll<HTMLElement>("[data-surface-node-id]")];
  const byId = new Map<string, HTMLElement[]>();
  for (const element of elements) {
    const nodeId = element.dataset.surfaceNodeId?.trim();
    if (!nodeId) continue;
    const existing = byId.get(nodeId) ?? [];
    existing.push(element);
    byId.set(nodeId, existing);
  }
  const liveNodeIds = new Set(input.graph.nodes.map((node) => node.nodeId));
  const expected = input.definition.nodes.filter((node) =>
    node.rendered !== false
    && liveNodeIds.has(node.nodeId)
    && (node.kind === "form" || node.kind === "field" || node.kind === "action"),
  );
  const missingRenderedNodeIds = expected.filter((node) => !byId.has(node.nodeId)).map((node) => node.nodeId).sort();
  const duplicateNodeIds = [...byId].filter(([, nodes]) => nodes.length > 1).map(([nodeId]) => nodeId).sort();
  const unmappedControlDescriptions = [...input.root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)]
    .filter((element) => !element.dataset.surfaceNodeId)
    .map((element) => `${element.tagName.toLocaleLowerCase()}:${accessibleText(element) || "unnamed"}`)
    .sort();
  const inaccessibleNodeIds = expected.filter((node) => {
    const element = byId.get(node.nodeId)?.[0];
    return !!element?.matches(CONTROL_SELECTOR) && !accessibleText(element);
  }).map((node) => node.nodeId).sort();
  return {
    ok: missingRenderedNodeIds.length === 0
      && duplicateNodeIds.length === 0
      && unmappedControlDescriptions.length === 0
      && inaccessibleNodeIds.length === 0,
    missingRenderedNodeIds,
    duplicateNodeIds,
    unmappedControlDescriptions,
    inaccessibleNodeIds,
  };
}

export type StructuredViewElementCandidate = {
  viewElementId: string;
  elementId: string;
  elementTypeSlug: string;
  parentViewElementId: string | null;
  orderIndex: number | null;
  rendererHint: string | null;
};

export type StructuredViewElement = StructuredViewElementCandidate & {
  childViewElements: StructuredViewElement[];
};

export type StructuredEdgeCandidate = {
  id: string;
  fromViewElementId: string;
  toViewElementId: string;
  relationshipTypeSlug: string;
};

function sortStructuredElements<T extends { orderIndex: number | null; viewElementId: string }>(elements: T[]): T[] {
  return [...elements].sort((left, right) => {
    const leftOrder = left.orderIndex ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.orderIndex ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.viewElementId.localeCompare(right.viewElementId);
  });
}

export function buildStructuredViewElements(
  elements: StructuredViewElementCandidate[],
): StructuredViewElement[] {
  const structuredById = new Map<string, StructuredViewElement>(
    elements.map((element) => [
      element.viewElementId,
      {
        ...element,
        childViewElements: [],
      },
    ]),
  );

  const roots: StructuredViewElement[] = [];
  for (const element of elements) {
    const structured = structuredById.get(element.viewElementId);
    if (!structured) continue;

    const parent =
      element.parentViewElementId == null
        ? null
        : structuredById.get(element.parentViewElementId) ?? null;

    if (!parent) {
      roots.push(structured);
      continue;
    }

    parent.childViewElements.push(structured);
  }

  const sortTree = (node: StructuredViewElement) => {
    node.childViewElements = sortStructuredElements(node.childViewElements);
    node.childViewElements.forEach(sortTree);
  };

  roots.forEach(sortTree);
  return roots;
}

export function filterStructuredEdges(
  edges: StructuredEdgeCandidate[],
  structuredElements: StructuredViewElement[],
): StructuredEdgeCandidate[] {
  const childViewElementToStructuredParent = new Map<string, string>();

  for (const element of structuredElements) {
    if (element.rendererHint !== "nested_chevron_sequence") continue;
    for (const child of element.childViewElements) {
      childViewElementToStructuredParent.set(child.viewElementId, element.viewElementId);
    }
  }

  return edges.filter((edge) => {
    if (edge.relationshipTypeSlug !== "flows_to") return true;

    const fromParent = childViewElementToStructuredParent.get(edge.fromViewElementId);
    const toParent = childViewElementToStructuredParent.get(edge.toViewElementId);
    if (!fromParent || !toParent) return true;

    return fromParent !== toParent;
  });
}

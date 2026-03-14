export type StructuredChildRecord = {
  viewElementId: string;
  elementId: string;
  elementTypeSlug: string;
  parentViewElementId: string | null;
  orderIndex: number | null;
};

export type StructureConformanceWarning = {
  issueType: "missing_required_children" | "detached_child" | "duplicate_order_index";
  severity: "warn" | "error";
  message: string;
  viewElementIds: string[];
  details?: Record<string, unknown>;
};

export function sortStructuredChildren(children: StructuredChildRecord[]): StructuredChildRecord[] {
  return [...children].sort((left, right) => {
    const leftOrder = left.orderIndex ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.orderIndex ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.viewElementId.localeCompare(right.viewElementId);
  });
}

export function deriveNestedChevronSequenceWarnings(input: {
  parentViewElementId: string;
  minChildren: number;
  children: StructuredChildRecord[];
}): StructureConformanceWarning[] {
  const warnings: StructureConformanceWarning[] = [];
  const attachedChildren = input.children.filter((child) => child.parentViewElementId === input.parentViewElementId);
  const detachedChildren = input.children.filter((child) => child.parentViewElementId !== input.parentViewElementId);

  if (attachedChildren.length < input.minChildren) {
    warnings.push({
      issueType: "missing_required_children",
      severity: "warn",
      message: `Expected at least ${input.minChildren} structured child elements`,
      viewElementIds: [input.parentViewElementId],
      details: { minChildren: input.minChildren, attachedChildCount: attachedChildren.length },
    });
  }

  for (const child of detachedChildren) {
    warnings.push({
      issueType: "detached_child",
      severity: "warn",
      message: "Structured child is detached from its expected parent",
      viewElementIds: [child.viewElementId],
      details: {
        expectedParentViewElementId: input.parentViewElementId,
        actualParentViewElementId: child.parentViewElementId,
      },
    });
  }

  const seenOrderIndexes = new Map<number, string[]>();
  for (const child of attachedChildren) {
    if (child.orderIndex == null) continue;
    const siblings = seenOrderIndexes.get(child.orderIndex) ?? [];
    siblings.push(child.viewElementId);
    seenOrderIndexes.set(child.orderIndex, siblings);
  }

  for (const [orderIndex, siblings] of seenOrderIndexes) {
    if (siblings.length < 2) continue;
    warnings.push({
      issueType: "duplicate_order_index",
      severity: "warn",
      message: `Multiple structured children share order index ${orderIndex}`,
      viewElementIds: siblings,
      details: { orderIndex },
    });
  }

  return warnings;
}

// apps/web/lib/ea/ea-core.ts
//
// Pure (no prisma / auth / Next.js) domain helpers for EA structured-view
// mutations: ordering, resequencing, insertion, and conformance-warning
// derivation for parent/child structured elements (e.g. value-stream stages).
// Extracted verbatim from lib/actions/ea.ts (BI-OPT-FAT-ACTIONS, EA slice) so
// the deterministic domain logic lives in the EA domain layer and is
// unit-testable on its own. Behavior-preserving relocation — identical bodies.

export type StructuredMutationRecord = {
  id: string;
  elementId: string;
  parentViewElementId: string | null;
  orderIndex: number | null;
};

export type StructuredConformanceWarning = {
  issueType: "missing_required_children" | "detached_child" | "duplicate_order_index";
  severity: "warn" | "error";
  message: string;
  viewElementIds: string[];
  details?: Record<string, unknown>;
};

export function sortStructuredMutationRecords(records: StructuredMutationRecord[]): StructuredMutationRecord[] {
  return [...records].sort((left, right) => {
    const leftOrder = left.orderIndex ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.orderIndex ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.id.localeCompare(right.id);
  });
}

export function resequenceStructuredChildren(
  records: StructuredMutationRecord[],
  parentViewElementId: string,
): StructuredMutationRecord[] {
  return sortStructuredMutationRecords(records).map((record, index) => ({
    ...record,
    parentViewElementId,
    orderIndex: index,
  }));
}

export function insertStructuredChild(
  records: StructuredMutationRecord[],
  movingRecord: StructuredMutationRecord,
  parentViewElementId: string,
  targetOrderIndex: number | null,
): StructuredMutationRecord[] {
  const ordered = sortStructuredMutationRecords(records.filter((record) => record.id !== movingRecord.id));
  const insertionIndex = targetOrderIndex == null
    ? ordered.length
    : Math.max(0, Math.min(targetOrderIndex, ordered.length));

  ordered.splice(insertionIndex, 0, {
    ...movingRecord,
    parentViewElementId,
  });

  return ordered.map((record, index) => ({
    ...record,
    parentViewElementId,
    orderIndex: index,
  }));
}

export function deriveStructuredWarnings(input: {
  parentViewElementId: string;
  minChildren: number;
  children: StructuredMutationRecord[];
}): StructuredConformanceWarning[] {
  const warnings: StructuredConformanceWarning[] = [];
  const attachedChildren = input.children.filter(
    (child) => child.parentViewElementId === input.parentViewElementId,
  );
  const detachedChildren = input.children.filter(
    (child) => child.parentViewElementId !== input.parentViewElementId,
  );

  if (attachedChildren.length < input.minChildren) {
    warnings.push({
      issueType: "missing_required_children",
      severity: "warn",
      message: `Expected at least ${input.minChildren} structured child elements`,
      viewElementIds: [input.parentViewElementId],
      details: {
        minChildren: input.minChildren,
        attachedChildCount: attachedChildren.length,
      },
    });
  }

  for (const child of detachedChildren) {
    warnings.push({
      issueType: "detached_child",
      severity: "warn",
      message: "Structured child is detached from its expected parent",
      viewElementIds: [child.id],
      details: {
        expectedParentViewElementId: input.parentViewElementId,
        actualParentViewElementId: child.parentViewElementId,
      },
    });
  }

  const siblingsByOrderIndex = new Map<number, string[]>();
  for (const child of attachedChildren) {
    if (child.orderIndex == null) continue;
    const siblings = siblingsByOrderIndex.get(child.orderIndex) ?? [];
    siblings.push(child.id);
    siblingsByOrderIndex.set(child.orderIndex, siblings);
  }

  for (const [orderIndex, siblings] of siblingsByOrderIndex) {
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

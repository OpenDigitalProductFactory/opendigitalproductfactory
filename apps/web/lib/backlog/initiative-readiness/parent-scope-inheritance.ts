/**
 * A decomposed plan's children inherit the parent's initiative scope.
 *
 * `initiative-readiness.v2` projects every item on its own activity rows, so a
 * child filed by `record_plan_backlog_coverage` (decision `decomposed`) owed a
 * second research receipt, a second spec-approval and a second plan review
 * against the very design its parent had already carried through those gates
 * (BI-B5C8FEFC: seven children, one reviewed design, kernel ruling
 * DI-C0989B8514AF option d). The mapping is the evidence: when the parent's
 * current coverage record names the child as a deliverable, the parent's scope
 * baseline, gate receipts and coverage record are the child's canonical design.
 *
 * Inheritance is read-only and one hop. It never rewrites a payload, never
 * raises the child's profile to the parent's, and yields to a baseline the child
 * minted itself.
 */

export const INITIATIVE_SCOPE_ACTIVITY_KINDS = [
  "initiative_gate_receipt", "initiative_scope_baseline", "plan_backlog_coverage",
] as const;

export type InheritableActivity = {
  id: string;
  kind: string;
  gateKey: string | null;
  recordedAt: Date;
  payload: unknown;
};

export type InheritedInitiativeScope = {
  parentItemId: string;
  coverageActivityId: string;
  activities: readonly InheritableActivity[];
};

export type InheritanceDb = {
  backlogItem: { findFirst(args: unknown): Promise<{ itemId: string } | null> };
  backlogItemActivity: { findMany(args: unknown): Promise<any[]> };
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** True when a schema-2 decomposed coverage payload names `childItemId` as a deliverable. */
export function coverageMapsChild(payload: unknown, childItemId: string): boolean {
  const record = object(payload);
  if (!record || record.schemaVersion !== 2 || record.decision !== "decomposed") return false;
  if (!Array.isArray(record.deliverables)) return false;
  return record.deliverables.some((deliverable) => object(deliverable)?.backlogItemId === childItemId);
}

/**
 * Newest decomposed coverage record on another item that maps `childItemId`,
 * with that parent's scope rows. Null when no parent claims the child.
 */
export async function loadInheritedInitiativeScope(
  db: InheritanceDb,
  args: { childItemId: string; childRowId: string },
): Promise<InheritedInitiativeScope | null> {
  const candidates = await db.backlogItemActivity.findMany({
    where: {
      kind: "plan_backlog_coverage",
      backlogItemId: { not: args.childRowId },
      payload: { path: ["deliverables"], array_contains: [{ backlogItemId: args.childItemId }] },
    },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    take: 10,
    select: { id: true, backlogItemId: true, payload: true },
  }) as Array<{ id: string; backlogItemId: string; payload: unknown }>;
  const coverage = candidates.find((row) => coverageMapsChild(row.payload, args.childItemId));
  if (!coverage) return null;
  const parent = await db.backlogItem.findFirst({ where: { id: coverage.backlogItemId }, select: { itemId: true } });
  if (!parent) return null;
  const activities = await db.backlogItemActivity.findMany({
    where: { backlogItemId: coverage.backlogItemId, kind: { in: [...INITIATIVE_SCOPE_ACTIVITY_KINDS] } },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    take: 200,
    select: { id: true, kind: true, gateKey: true, recordedAt: true, payload: true },
  }) as InheritableActivity[];
  return { parentItemId: parent.itemId, coverageActivityId: coverage.id, activities };
}

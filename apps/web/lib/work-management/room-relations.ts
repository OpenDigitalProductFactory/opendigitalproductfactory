/**
 * Work-coordination relations (BI-662254C6).
 *
 * Five relations, not a parent column: contains, spawned-from, depends-on,
 * blocks, contributes-to. Portfolio dependencies stay in FPAW and are never
 * converted into these edges.
 */
export const WORKROOM_RELATION_KINDS = [
  "contains",
  "spawned-from",
  "depends-on",
  "blocks",
  "contributes-to",
] as const;

export type WorkroomRelationKind = (typeof WORKROOM_RELATION_KINDS)[number];

export const PORTFOLIO_DEPENDENCY_KIND_ALIASES = [
  "portfolio-depends-on",
  "portfolio-serves",
  "servesPortfolioRoles",
  "dependsOnPortfolioRoles",
  "fpaw-dependency",
] as const;

export type WorkroomRelation = {
  fromWorkroomId: string;
  toWorkroomId: string;
  relation: WorkroomRelationKind;
};

export class WorkroomRelationError extends Error {
  constructor(readonly reason: "unknown_kind" | "portfolio_dependency" | "contains_cycle" | "self_relation", message: string) {
    super(message);
    this.name = "WorkroomRelationError";
  }
}

function isRelationKind(value: unknown): value is WorkroomRelationKind {
  return typeof value === "string" && (WORKROOM_RELATION_KINDS as readonly string[]).includes(value);
}

export function parseWorkroomRelation(input: unknown): WorkroomRelation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new WorkroomRelationError("unknown_kind", "Workroom relation must be an object.");
  }
  const row = input as Record<string, unknown>;
  const fromWorkroomId = typeof row.fromWorkroomId === "string" ? row.fromWorkroomId.trim() : "";
  const toWorkroomId = typeof row.toWorkroomId === "string" ? row.toWorkroomId.trim() : "";
  if (!fromWorkroomId || !toWorkroomId) {
    throw new WorkroomRelationError("unknown_kind", "Workroom relation requires fromWorkroomId and toWorkroomId.");
  }
  if (typeof row.relation === "string" && (PORTFOLIO_DEPENDENCY_KIND_ALIASES as readonly string[]).includes(row.relation)) {
    throw new WorkroomRelationError(
      "portfolio_dependency",
      "Portfolio dependencies are not work-coordination relations and must not be converted.",
    );
  }
  if (!isRelationKind(row.relation)) {
    throw new WorkroomRelationError("unknown_kind", `Unknown work-coordination relation ${String(row.relation)}.`);
  }
  if (fromWorkroomId === toWorkroomId) {
    throw new WorkroomRelationError("self_relation", "A Workroom cannot relate to itself.");
  }
  return { fromWorkroomId, toWorkroomId, relation: row.relation };
}

export function containsWouldCycle(
  existing: readonly WorkroomRelation[],
  fromWorkroomId: string,
  toWorkroomId: string,
): boolean {
  if (fromWorkroomId === toWorkroomId) return true;
  const children = new Map<string, string[]>();
  for (const edge of existing) {
    if (edge.relation !== "contains") continue;
    const list = children.get(edge.fromWorkroomId) ?? [];
    list.push(edge.toWorkroomId);
    children.set(edge.fromWorkroomId, list);
  }
  const seen = new Set<string>();
  const stack = [toWorkroomId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === fromWorkroomId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const child of children.get(current) ?? []) stack.push(child);
  }
  return false;
}

export function assertWorkroomRelation(
  existing: readonly WorkroomRelation[],
  candidate: unknown,
): WorkroomRelation {
  const parsed = parseWorkroomRelation(candidate);
  if (parsed.relation === "contains" && containsWouldCycle(existing, parsed.fromWorkroomId, parsed.toWorkroomId)) {
    throw new WorkroomRelationError(
      "contains_cycle",
      `contains ${parsed.fromWorkroomId} → ${parsed.toWorkroomId} would cycle.`,
    );
  }
  return parsed;
}

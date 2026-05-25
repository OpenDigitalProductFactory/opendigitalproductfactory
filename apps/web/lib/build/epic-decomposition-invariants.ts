// apps/web/lib/build/epic-decomposition-invariants.ts
//
// Phase 1 substrate for design-time decomposition.
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md
// BI: BI-2E6CC391.
//
// Pure invariant assertions executed at the application layer — Prisma's schema
// encodes nullability and FK shape, but the cross-row semantic rules (parent
// must carry a contract, child review is transitive, dependency edges must stay
// within one Epic, the dependency graph must be acyclic, recursive
// decomposition is forbidden in Phase 1) live here.
//
// All functions are pure: callers fetch the relevant rows from Prisma and pass
// them in. This keeps the unit tests fast and DB-free, and means the same
// invariants can run inside the same transaction that performs the write
// (Prisma transaction callback receives a tx client; the caller queries with
// it, then calls these).
//
// Failure mode: throw `DecompositionInvariantError` with a stable `code`. The
// caller decides whether to surface the error to the user, abort the
// transaction, or escalate. Loud failure is intentional — silent skips on
// invariant violation cause exactly the seed-side foot-guns documented in
// `project_silent_seed_skips_audit` and `project_agent_grant_seeding_gap`.

export class DecompositionInvariantError extends Error {
  constructor(
    public readonly code: DecompositionInvariantCode,
    message: string,
  ) {
    super(message);
    this.name = "DecompositionInvariantError";
  }
}

export type DecompositionInvariantCode =
  | "epic-without-contract"
  | "child-parent-mismatch"
  | "child-review-divergence"
  | "self-dependency"
  | "cross-epic-dependent"
  | "cross-epic-dependson"
  | "dependency-cycle"
  | "recursive-decomposition"
  | "invalid-child-order";

// ---------------------------------------------------------------------------
// 1. An Epic with FeatureBuild children must carry a designDoc contract.
//
// Portfolio-organizational Epics (the existing use today) have only
// `BacklogItem[]` and no `designDoc` — they remain valid. The invariant
// fires only when an Epic gains at least one `FeatureBuild` child, at
// which point the parent contract must exist.
// ---------------------------------------------------------------------------

export function assertEpicHasContractIfDecomposed(epic: {
  designDoc: unknown | null;
  featureBuilds?: ReadonlyArray<unknown> | null;
}): void {
  const hasChildren = (epic.featureBuilds?.length ?? 0) > 0;
  if (hasChildren && epic.designDoc == null) {
    throw new DecompositionInvariantError(
      "epic-without-contract",
      "Epic has child FeatureBuilds but no designDoc. Execution-organizational Epics must carry the immutable design contract.",
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Child design-review approval is transitive from parent at creation.
//
// The parent Epic's `designReview` (set when `reviewDesignDoc` passed in
// Ideate) IS the child's review approval. Children skip `reviewDesignDoc`
// and go straight to Plan. To preserve auditability the child's
// `designReview` must equal the parent's at creation time.
// ---------------------------------------------------------------------------

export function assertChildDesignReviewTransitive(
  child: { parentEpicId: string | null; designReview: unknown | null },
  parent: { id: string; designReview: unknown | null },
): void {
  if (child.parentEpicId == null) return; // top-level build; no parent to transit from
  if (child.parentEpicId !== parent.id) {
    throw new DecompositionInvariantError(
      "child-parent-mismatch",
      `Child's parentEpicId (${child.parentEpicId}) does not match supplied parent Epic id (${parent.id}).`,
    );
  }
  if (!designReviewsEquivalent(child.designReview, parent.designReview)) {
    throw new DecompositionInvariantError(
      "child-review-divergence",
      "Child's designReview does not match parent Epic's. At child creation, the parent's review approval must be copied to the child.",
    );
  }
}

function designReviewsEquivalent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  // Structural equality, order-insensitive at object-key level. Both sides
  // are JSON-shaped artifacts written from the reviewDesignDoc tool; they
  // typically arrive in the same insertion order, but the invariant must
  // not depend on that — a serialization round-trip can re-key.
  return canonicalJson(a) === canonicalJson(b);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

// ---------------------------------------------------------------------------
// 3. A dependency edge must stay within one Epic, and a build cannot depend
//    on itself.
//
// Cross-Epic dependency edges would imply that one Epic's children
// coordinate with another Epic's, which collapses the "each Epic is one
// coordinated body of work" framing. Self-loops are nonsensical and would
// cause the rollup logic to deadlock immediately.
// ---------------------------------------------------------------------------

export function assertDependencyEdgeWellFormed(args: {
  dependent: { id: string; parentEpicId: string | null };
  dependsOn: { id: string; parentEpicId: string | null };
  parentEpicId: string;
}): void {
  const { dependent, dependsOn, parentEpicId } = args;
  if (dependent.id === dependsOn.id) {
    throw new DecompositionInvariantError(
      "self-dependency",
      `FeatureBuild ${dependent.id} cannot depend on itself.`,
    );
  }
  if (dependent.parentEpicId !== parentEpicId) {
    throw new DecompositionInvariantError(
      "cross-epic-dependent",
      `Dependent build's parentEpicId (${dependent.parentEpicId ?? "null"}) does not match the dependency edge's parentEpicId (${parentEpicId}).`,
    );
  }
  if (dependsOn.parentEpicId !== parentEpicId) {
    throw new DecompositionInvariantError(
      "cross-epic-dependson",
      `DependsOn build's parentEpicId (${dependsOn.parentEpicId ?? "null"}) does not match the dependency edge's parentEpicId (${parentEpicId}).`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Adding a new dependency edge must not create a cycle.
//
// Iterative DFS with three-colour marking. Caller passes the full set of
// existing edges (within the parent Epic — cross-Epic edges are already
// rejected by (3)) plus the proposed new edge.
// ---------------------------------------------------------------------------

export function assertNoCycle(args: {
  existingEdges: ReadonlyArray<{ dependentBuildId: string; dependsOnBuildId: string }>;
  newEdge: { dependentBuildId: string; dependsOnBuildId: string };
}): void {
  const { existingEdges, newEdge } = args;
  const allEdges = [...existingEdges, newEdge];

  // Adjacency list: node -> nodes it depends on.
  const adj = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const edge of allEdges) {
    const list = adj.get(edge.dependentBuildId) ?? [];
    list.push(edge.dependsOnBuildId);
    adj.set(edge.dependentBuildId, list);
    nodes.add(edge.dependentBuildId);
    nodes.add(edge.dependsOnBuildId);
  }

  // Three-colour DFS. WHITE = unvisited, GRAY = in current DFS stack,
  // BLACK = fully processed. A GRAY-target back edge is a cycle.
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();

  const dfs = (root: string): boolean => {
    const stack: Array<{ node: string; iter: Iterator<string> }> = [];
    colour.set(root, GRAY);
    stack.push({ node: root, iter: (adj.get(root) ?? [])[Symbol.iterator]() });
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const next = frame.iter.next();
      if (next.done) {
        colour.set(frame.node, BLACK);
        stack.pop();
        continue;
      }
      const child = next.value;
      const c = colour.get(child) ?? WHITE;
      if (c === GRAY) return true;
      if (c === BLACK) continue;
      colour.set(child, GRAY);
      stack.push({ node: child, iter: (adj.get(child) ?? [])[Symbol.iterator]() });
    }
    return false;
  };

  for (const node of nodes) {
    if ((colour.get(node) ?? WHITE) === WHITE) {
      if (dfs(node)) {
        throw new DecompositionInvariantError(
          "dependency-cycle",
          `Adding edge ${newEdge.dependentBuildId} -> ${newEdge.dependsOnBuildId} would create a cycle in the FeatureBuildDependency graph.`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Recursive decomposition is forbidden in Phase 1 (Mark's §12 Q4 decision).
//
// A FeatureBuild with `parentEpicId` set cannot itself be decomposed — it
// cannot become the originating build for another Epic. If a child build
// hits Plan oscillation, the operator must amend the parent Epic's design
// (per §5 of the spec) or abandon the child, not nest a grandchild Epic.
// ---------------------------------------------------------------------------

export function assertNoRecursiveDecomposition(originatingBuild: {
  id: string;
  parentEpicId: string | null;
}): void {
  if (originatingBuild.parentEpicId != null) {
    throw new DecompositionInvariantError(
      "recursive-decomposition",
      `FeatureBuild ${originatingBuild.id} already has parentEpicId=${originatingBuild.parentEpicId}; recursive decomposition is forbidden in Phase 1. Amend the parent Epic's design or abandon the child instead.`,
    );
  }
}

// ---------------------------------------------------------------------------
// 6. childOrder is 1-indexed when set; null is allowed only for top-level
//    (non-child) builds.
//
// Uniqueness of childOrder within a parent is enforced by the caller at
// creation time (and could be promoted to a partial unique index in a
// future migration); this assertion guards only the per-row well-formedness.
// ---------------------------------------------------------------------------

export function assertChildOrderWellFormed(child: {
  parentEpicId: string | null;
  childOrder: number | null;
}): void {
  if (child.parentEpicId == null) {
    if (child.childOrder != null) {
      throw new DecompositionInvariantError(
        "invalid-child-order",
        "childOrder must be null when parentEpicId is null (top-level builds carry no ordering within an Epic).",
      );
    }
    return;
  }
  if (child.childOrder == null) {
    throw new DecompositionInvariantError(
      "invalid-child-order",
      "childOrder is required when parentEpicId is set.",
    );
  }
  if (!Number.isInteger(child.childOrder) || child.childOrder < 1) {
    throw new DecompositionInvariantError(
      "invalid-child-order",
      `childOrder must be a positive integer (1-indexed); got ${child.childOrder}.`,
    );
  }
}

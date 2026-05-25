// apps/web/lib/build/decomposition-candidates.ts
//
// Phase 4a of the design-time decomposition rollout.
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md
// BI: BI-2E6CC391.
//
// Type definitions, parsing, validation, and child-designDoc derivation for
// the decomposition-assistant flow. Phase 4a ships the server-side substrate;
// the LLM call that produces candidates and the operator slide-over that
// picks one both land in Phase 4b.
//
// A DecompositionCandidate is a proposed partition of a parent design's
// acceptance criteria into 2-4 coherent child scopes, each producing a
// FeatureBuild that implements a subset of the parent's contract. Dependency
// edges between siblings are also part of the candidate so the operator can
// see "child B depends on child A" before approving.
//
// `parseCandidatesResponse` is permissive on shape (accepts both bare
// `Candidate[]` and `{ candidates: Candidate[] }` envelopes, because LLM
// output varies); `validateCandidate` is strict (rejects shapes that would
// violate the Phase 1 invariants downstream). Both are pure — caller passes
// the parent design and the candidate; we never read from Prisma here.

import type { BuildDesignDoc } from "@/lib/explore/feature-build-types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DecompositionChildScope = {
  /** 1-indexed position within the parent Epic. Determines build creation
   *  order and rollup display order. */
  childOrder: number;
  /** Operator-facing title in the persona's vocabulary (truck/parts/job for
   *  Dale), not platform vocabulary. Becomes FeatureBuild.title. */
  title: string;
  /** One-sentence summary the assistant slide-over and rollup UI render. */
  summary: string;
  /** Indices into the parent's `designDoc.acceptanceCriteria[]`. The child's
   *  derived designDoc contains exactly these ACs. Must be non-empty;
   *  partition (every parent AC appears in exactly one child) is asserted
   *  at the candidate level. */
  acceptanceCriteriaIndices: number[];
  /** childOrder values within THIS candidate that this child depends on.
   *  Empty = no sibling deps. Cycles rejected at validate-time. */
  dependsOn: number[];
};

export type DecompositionCandidate = {
  /** Stable identifier within the persisted candidate list. The operator
   *  selects by this id when approving. */
  candidateId: string;
  /** Plain-language rationale for THIS partition. Surfaces in the
   *  slide-over so the operator understands why the agent grouped these ACs
   *  together rather than another way. */
  rationale: string;
  /** 2-4 child scopes in childOrder order. */
  childScopes: DecompositionChildScope[];
};

export type ValidationFailure = {
  code: ValidationFailureCode;
  message: string;
  /** Optional reference to the offending child scope (1-indexed). */
  childOrder?: number;
};

export type ValidationFailureCode =
  | "no-children"
  | "too-few-children"
  | "too-many-children"
  | "duplicate-child-order"
  | "non-sequential-child-order"
  | "missing-ac-coverage"
  | "duplicate-ac-coverage"
  | "ac-index-out-of-range"
  | "empty-child-scope"
  | "self-dependency"
  | "missing-dependency-target"
  | "dependency-cycle"
  | "empty-title"
  | "empty-rationale";

export type ValidateResult =
  | { ok: true }
  | { ok: false; failures: ValidationFailure[] };

// Constraints (matches spec §3.2 "2-4 candidate decompositions").
const MIN_CHILDREN = 2;
const MAX_CHILDREN = 4;

// ---------------------------------------------------------------------------
// parseCandidatesResponse — permissive
// ---------------------------------------------------------------------------

export function parseCandidatesResponse(raw: string): DecompositionCandidate[] {
  // Strip code fences if the LLM wrapped the JSON in ```json ... ```.
  const stripped = stripCodeFences(raw.trim());

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return [];
  }

  // Accept either `{ candidates: [...] }` or bare `[...]`.
  const candidatesRaw = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.candidates)
      ? parsed.candidates
      : null;

  if (!candidatesRaw) return [];

  const out: DecompositionCandidate[] = [];
  for (let i = 0; i < candidatesRaw.length; i++) {
    const c = candidatesRaw[i];
    if (!isRecord(c)) continue;
    const scopesRaw = Array.isArray(c.childScopes) ? c.childScopes : [];
    const childScopes: DecompositionChildScope[] = [];
    for (const s of scopesRaw) {
      if (!isRecord(s)) continue;
      const scope: DecompositionChildScope = {
        childOrder: numberOr(s.childOrder, 0),
        title: stringOr(s.title, ""),
        summary: stringOr(s.summary, ""),
        acceptanceCriteriaIndices: numberArrayOr(s.acceptanceCriteriaIndices, []),
        dependsOn: numberArrayOr(s.dependsOn, []),
      };
      childScopes.push(scope);
    }
    out.push({
      candidateId: stringOr(c.candidateId, `candidate-${i + 1}`),
      rationale: stringOr(c.rationale, ""),
      childScopes,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// validateCandidate — strict
// ---------------------------------------------------------------------------

export function validateCandidate(
  candidate: DecompositionCandidate,
  parentDoc: BuildDesignDoc,
): ValidateResult {
  const failures: ValidationFailure[] = [];
  const parentAcCount = (parentDoc.acceptanceCriteria ?? []).length;

  if (candidate.rationale.trim().length === 0) {
    failures.push({ code: "empty-rationale", message: "Candidate rationale is empty." });
  }

  const children = candidate.childScopes;
  if (children.length === 0) {
    failures.push({ code: "no-children", message: "Candidate has no child scopes." });
  } else if (children.length < MIN_CHILDREN) {
    failures.push({
      code: "too-few-children",
      message: `Candidate must have at least ${MIN_CHILDREN} child scopes; found ${children.length}.`,
    });
  } else if (children.length > MAX_CHILDREN) {
    failures.push({
      code: "too-many-children",
      message: `Candidate must have at most ${MAX_CHILDREN} child scopes; found ${children.length}.`,
    });
  }

  // childOrder must be the 1..N sequence with no gaps and no dupes.
  const orderSeen = new Set<number>();
  for (const scope of children) {
    if (scope.title.trim().length === 0) {
      failures.push({
        code: "empty-title",
        message: "Child scope has empty title.",
        childOrder: scope.childOrder,
      });
    }
    if (scope.acceptanceCriteriaIndices.length === 0) {
      failures.push({
        code: "empty-child-scope",
        message: "Child scope has no acceptance criteria assigned.",
        childOrder: scope.childOrder,
      });
    }
    if (orderSeen.has(scope.childOrder)) {
      failures.push({
        code: "duplicate-child-order",
        message: `Duplicate childOrder=${scope.childOrder}.`,
        childOrder: scope.childOrder,
      });
    }
    orderSeen.add(scope.childOrder);
  }
  // Sequence check (after dup check). Expect orderSeen to be {1, 2, ..., N}.
  for (let i = 1; i <= children.length; i++) {
    if (!orderSeen.has(i)) {
      failures.push({
        code: "non-sequential-child-order",
        message: `childOrder must be 1..${children.length} with no gaps; ${i} is missing.`,
      });
    }
  }

  // AC coverage: every parent AC appears in exactly one child.
  const acAssignment = new Map<number, number>(); // ac index -> first child it appears in
  const duplicateAcs = new Set<number>();
  for (const scope of children) {
    for (const acIdx of scope.acceptanceCriteriaIndices) {
      if (acIdx < 0 || acIdx >= parentAcCount) {
        failures.push({
          code: "ac-index-out-of-range",
          message: `Acceptance criterion index ${acIdx} is out of range (parent has ${parentAcCount} ACs).`,
          childOrder: scope.childOrder,
        });
        continue;
      }
      if (acAssignment.has(acIdx)) {
        duplicateAcs.add(acIdx);
      } else {
        acAssignment.set(acIdx, scope.childOrder);
      }
    }
  }
  for (const dup of duplicateAcs) {
    failures.push({
      code: "duplicate-ac-coverage",
      message: `Acceptance criterion index ${dup} is assigned to multiple child scopes.`,
    });
  }
  for (let i = 0; i < parentAcCount; i++) {
    if (!acAssignment.has(i)) {
      failures.push({
        code: "missing-ac-coverage",
        message: `Parent acceptance criterion index ${i} is not assigned to any child scope.`,
      });
    }
  }

  // Dependency edges within the candidate.
  const validOrders = new Set(children.map((c) => c.childOrder));
  for (const scope of children) {
    for (const dep of scope.dependsOn) {
      if (dep === scope.childOrder) {
        failures.push({
          code: "self-dependency",
          message: `Child scope childOrder=${scope.childOrder} cannot depend on itself.`,
          childOrder: scope.childOrder,
        });
      } else if (!validOrders.has(dep)) {
        failures.push({
          code: "missing-dependency-target",
          message: `Child scope childOrder=${scope.childOrder} depends on missing childOrder=${dep}.`,
          childOrder: scope.childOrder,
        });
      }
    }
  }

  // Cycle detection among childOrder edges (DFS three-colour).
  if (hasDependencyCycle(children)) {
    failures.push({
      code: "dependency-cycle",
      message: "Dependency graph among child scopes has a cycle.",
    });
  }

  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}

// ---------------------------------------------------------------------------
// candidateToChildDesignDocs — derive each child's designDoc from the parent
// by ACSV (acceptance-criteria subset projection). Keeps the parent's
// problemStatement and reusePlan (children inherit context), narrows
// proposedApproach to a child-scoped one-liner, and filters
// acceptanceCriteria to the child's indices.
// ---------------------------------------------------------------------------

export function candidateToChildDesignDocs(
  candidate: DecompositionCandidate,
  parentDoc: BuildDesignDoc,
): Array<{ childOrder: number; title: string; designDoc: BuildDesignDoc }> {
  return candidate.childScopes
    .slice()
    .sort((a, b) => a.childOrder - b.childOrder)
    .map((scope) => ({
      childOrder: scope.childOrder,
      title: scope.title,
      designDoc: {
        problemStatement: parentDoc.problemStatement,
        ...(parentDoc.dataModel ? { dataModel: parentDoc.dataModel } : {}),
        ...(parentDoc.existingCodeAudit
          ? { existingCodeAudit: parentDoc.existingCodeAudit }
          : {}),
        ...(parentDoc.existingFunctionalityAudit
          ? { existingFunctionalityAudit: parentDoc.existingFunctionalityAudit }
          : {}),
        reusePlan: parentDoc.reusePlan,
        proposedApproach: scope.summary || parentDoc.proposedApproach,
        acceptanceCriteria: scope.acceptanceCriteriaIndices.map(
          (i) => parentDoc.acceptanceCriteria![i]!,
        ),
        ...(parentDoc.reusabilityAnalysis
          ? { reusabilityAnalysis: parentDoc.reusabilityAnalysis }
          : {}),
        ...(parentDoc.accessibility ? { accessibility: parentDoc.accessibility } : {}),
      },
    }));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stripCodeFences(s: string): string {
  // Strip ```json\n ... \n``` or ```\n ... \n``` wrappers.
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(s);
  return fenced ? fenced[1]!.trim() : s;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function numberArrayOr(v: unknown, fallback: number[]): number[] {
  if (!Array.isArray(v)) return fallback;
  const out: number[] = [];
  for (const item of v) {
    if (typeof item === "number" && Number.isFinite(item)) out.push(item);
  }
  return out;
}

function hasDependencyCycle(children: DecompositionChildScope[]): boolean {
  // childOrder is the node id; dependsOn lists predecessors.
  const adj = new Map<number, number[]>();
  for (const s of children) {
    adj.set(s.childOrder, s.dependsOn.slice());
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const colour = new Map<number, number>();

  function dfs(node: number): boolean {
    colour.set(node, GRAY);
    for (const next of adj.get(node) ?? []) {
      const c = colour.get(next) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && dfs(next)) return true;
    }
    colour.set(node, BLACK);
    return false;
  }

  for (const node of adj.keys()) {
    if ((colour.get(node) ?? WHITE) === WHITE) {
      if (dfs(node)) return true;
    }
  }
  return false;
}

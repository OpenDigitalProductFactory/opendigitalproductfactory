// apps/web/lib/build/auto-resolve-decompose-gate.ts
//
// BI-C4F828B7 — autonomous resolution of the ideate `decompose-required` gate
// for governed-backlog autopilot builds.
//
// Why this exists:
//   The daily governed-backlog tee-up (0 14 * * *, cap 3/day) auto-promotes
//   backlog items into FeatureBuilds and fires Ideate hands-off. When the
//   deterministic design-time size assessment returns `decompose-required`, the
//   Phase-4b gate (apps/web/lib/mcp-tools.ts reviewDesignDoc) blocks the advance
//   and waits for an OPERATOR to call approve_decomposition or
//   record_decomposition_override. On an unattended install nobody clicks, so
//   the build parks in `ideate` forever and is eventually reaped to `abandoned`
//   (BI-A009313E / PR #3196 downstream cap). Meanwhile the tee-up keeps minting
//   more — a self-perpetuating loop (~65% of design-reviewed auto-promotions hit
//   this gate on the founder install).
//
//   Under governed-backlog autopilot the operator has ALREADY confirmed intent
//   (triage=build + promote + auto-approve-start — see governed-backlog-tee-up.ts).
//   Requiring a separate decomposition click duplicates that confirmation and is
//   the only thing standing between a passed design and forward progress. So for
//   autopilot builds we resolve the gate autonomously instead of parking:
//     - top-level build  → approve the top generated decomposition candidate
//       (generating candidates first if none exist). The parent is superseded
//       into an Epic + child builds that proceed on their own.
//     - if candidates cannot be generated OR approval fails → auto-record a
//       monolithic override so the build ships as one rather than parking.
//     - a decomposed child (parentEpicId != null) can never be re-decomposed
//       (assertNoRecursiveDecomposition); defensively it auto-overrides. In
//       practice children are created in `plan`, so they never reach this gate.
//
//   Operator-driven builds (or non-governed installs) are untouched: they return
//   `park`, and the caller keeps the existing "wait for the operator" behavior.
//
// Contract: this module NEVER parks an eligible autopilot build. Every eligible
// path returns `decomposed` or `overridden` so the pipeline keeps moving.

import type { DecompositionCandidate } from "./decomposition-candidates";
import type { ProposeDecompositionResult } from "./propose-decomposition";
import type { ApproveDecompositionResult } from "./approve-decomposition";
import type { RecordDecompositionOverrideResult } from "./decomposition-override";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AutoResolveDecomposeBuild = {
  buildId: string;
  /** Non-null once the build is a decomposed child — cannot be re-decomposed. */
  parentEpicId: string | null;
  /** Provenance signal: governed-backlog autopilot builds carry a BI link. */
  originatingBacklogItemId: string | null;
  /** The build's designReview JSON — read for decompositionCandidates.latest. */
  designReview: unknown;
};

/** The three server-side decomposition primitives, injected for testability. */
export type AutoResolveDecomposeDeps = {
  proposeDecomposition: (args: {
    buildId: string;
    userId: string;
  }) => Promise<ProposeDecompositionResult>;
  approveDecomposition: (args: {
    buildId: string;
    candidate: DecompositionCandidate;
    userId: string;
  }) => Promise<ApproveDecompositionResult>;
  recordDecompositionOverride: (args: {
    buildId: string;
    rationale: string;
    userId: string;
  }) => Promise<RecordDecompositionOverrideResult>;
};

export type AutoResolveDecomposeInput = {
  build: AutoResolveDecomposeBuild;
  userId: string;
  /** Only autopilot (governed-backlog) installs auto-resolve the gate. */
  governedBacklogEnabled: boolean;
  /** Injected primitives; default to the real server-side implementations. */
  deps?: Partial<AutoResolveDecomposeDeps>;
};

export type AutoOverrideReason = "child" | "no-candidates" | "approve-failed";

export type AutoResolveDecomposeResult =
  /** Not an autopilot build (or not governed) — caller keeps the park behavior. */
  | { action: "park" }
  /** Superseded into an Epic + child builds; parent is no longer live. */
  | {
      action: "decomposed";
      epicId: string;
      childBuildIds: string[];
      candidateId: string;
    }
  /** Monolithic override recorded; caller may advance the build to Plan. */
  | { action: "overridden"; rationale: string; reason: AutoOverrideReason };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the persisted candidate list off a build's designReview, defensively. */
function readLatestCandidates(designReview: unknown): DecompositionCandidate[] {
  const review = (designReview ?? null) as
    | { decompositionCandidates?: { latest?: unknown } | null }
    | null;
  const latest = review?.decompositionCandidates?.latest;
  return Array.isArray(latest) ? (latest as DecompositionCandidate[]) : [];
}

async function defaultProposeDecomposition(args: {
  buildId: string;
  userId: string;
}): Promise<ProposeDecompositionResult> {
  const { proposeDecomposition } = await import("./propose-decomposition");
  return proposeDecomposition(args);
}

async function defaultApproveDecomposition(args: {
  buildId: string;
  candidate: DecompositionCandidate;
  userId: string;
}): Promise<ApproveDecompositionResult> {
  const { approveDecomposition } = await import("./approve-decomposition");
  return approveDecomposition(args);
}

async function defaultRecordDecompositionOverride(args: {
  buildId: string;
  rationale: string;
  userId: string;
}): Promise<RecordDecompositionOverrideResult> {
  const { recordDecompositionOverride } = await import("./decomposition-override");
  return recordDecompositionOverride(args);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function autoResolveDecomposeRequiredGate(
  input: AutoResolveDecomposeInput,
): Promise<AutoResolveDecomposeResult> {
  const { build, userId, governedBacklogEnabled } = input;
  const deps: AutoResolveDecomposeDeps = {
    proposeDecomposition: input.deps?.proposeDecomposition ?? defaultProposeDecomposition,
    approveDecomposition: input.deps?.approveDecomposition ?? defaultApproveDecomposition,
    recordDecompositionOverride:
      input.deps?.recordDecompositionOverride ?? defaultRecordDecompositionOverride,
  };

  // Only governed-backlog autopilot builds auto-resolve. An operator-driven
  // build (no BI link) or a non-governed install parks as before — the operator
  // is watching and will decide.
  if (!governedBacklogEnabled || build.originatingBacklogItemId == null) {
    return { action: "park" };
  }

  // Recursion terminator: a decomposed child can never be re-decomposed
  // (assertNoRecursiveDecomposition). Ship it monolithically. Children are
  // normally created in `plan` and never reach this gate — this is defensive.
  if (build.parentEpicId != null) {
    return overrideOrPark(deps, build.buildId, userId, "child");
  }

  // Top-level autopilot build: auto-decompose. Ensure candidates exist first.
  let candidates = readLatestCandidates(build.designReview);
  if (candidates.length === 0) {
    const proposed = await deps.proposeDecomposition({ buildId: build.buildId, userId });
    if (proposed.ok) {
      candidates = proposed.candidates;
    }
  }
  if (candidates.length === 0) {
    // No valid partition could be generated — proceed monolithically rather
    // than park. The size gate is advisory; shipping-as-one beats rotting.
    return overrideOrPark(deps, build.buildId, userId, "no-candidates");
  }

  // Approve the top candidate. candidateToChildDesignDocs / validateCandidate run
  // inside approveDecomposition, so an invalid candidate fails loudly here and we
  // fall back to a monolithic override.
  const chosen = candidates[0]!;
  const approved = await deps.approveDecomposition({
    buildId: build.buildId,
    candidate: chosen,
    userId,
  });
  if (approved.ok) {
    return {
      action: "decomposed",
      epicId: approved.epicId,
      childBuildIds: approved.childBuildIds,
      candidateId: chosen.candidateId,
    };
  }

  return overrideOrPark(deps, build.buildId, userId, "approve-failed");
}

/**
 * Record a monolithic override so the build advances instead of parking. If the
 * override itself cannot be recorded (should not happen at a decompose-required
 * gate), fall back to `park` so the caller preserves the existing safe behavior
 * rather than silently advancing an unresolved build.
 */
async function overrideOrPark(
  deps: AutoResolveDecomposeDeps,
  buildId: string,
  userId: string,
  reason: AutoOverrideReason,
): Promise<AutoResolveDecomposeResult> {
  const rationale = autoOverrideRationale(reason);
  const result = await deps.recordDecompositionOverride({ buildId, rationale, userId });
  if (result.ok) {
    return { action: "overridden", rationale, reason };
  }
  return { action: "park" };
}

function autoOverrideRationale(reason: AutoOverrideReason): string {
  switch (reason) {
    case "child":
      return "Auto-override (BI-C4F828B7): governed autopilot — a decomposed child cannot be split further; proceeding monolithically.";
    case "no-candidates":
      return "Auto-override (BI-C4F828B7): governed autopilot — no valid decomposition candidate could be generated; proceeding monolithically.";
    case "approve-failed":
      return "Auto-override (BI-C4F828B7): governed autopilot — decomposition approval failed; proceeding monolithically.";
  }
}

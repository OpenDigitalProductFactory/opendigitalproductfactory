// Work-warrant altitude classifier (EP-7B169558 / BI-8AB0E66D).
//
// Classifies a unit of work into a DECISION ALTITUDE — WSID (task/job),
// WWWD (business/org, industry-vertical), or WWMD (architectural/platform) —
// which the WorkWarrant then uses to meter execution (lane, token/model budget,
// evidence depth, reporting format, context scope).
//
// COLD-START (the load-bearing property, kernel-ratified structure-first,
// composite 0.874, "Architecture Over Shortcuts" top contributor):
// this function classifies from DETERMINISTIC, DAY-ONE STRUCTURAL signals only —
// it needs NO established WWWD/WSID corpus to run. The corpus is a later OVERLAY
// (applied by the caller, flipping `basis` to "corpus") and an operator override
// (`basis` "operator"); every verdict + its outcome is meant to SEED that corpus
// so it sharpens from operation. The asymmetry that makes this safe:
//   - WWMD (expensive to mis-classify) is covered here by hard structural rules,
//     because its corpus (principle dimensions, AGENTS.md, golden decisions) is
//     already established — so the must-be-right end is right on a fresh install.
//   - WSID (cheap to mis-classify) rides structural defaults.
//   - Only the thin WWWD middle defers to operator-confirm — and each
//     confirmation is a corpus seed, not a blocker.
//
// This module is intentionally pure and dependency-free so it is fully
// unit-testable WITHOUT any corpus, DB, or model — which is exactly why it is
// the right first artifact for the control plane.

export type Altitude = "WSID" | "WWWD" | "WWMD";

/** Provenance of the classification — lets an auditor see the classifier shift
 *  from structural → corpus-driven as the org matures, and never trust corpus it
 *  does not have. */
export type AltitudeBasis = "structural" | "corpus" | "operator";

export type AltitudeConfidence = "high" | "medium" | "low";

export type EffortSize = "small" | "medium" | "large" | "xlarge";

/** Deterministic structural signals, all present at promote/triage on day one. */
export interface AltitudeSignals {
  /** BacklogItem.effortSize. */
  effortSize?: EffortSize | null;
  /** BacklogItem.workType (feature | bug | chore | doc | tool | skill | refactor). */
  workType?: string | null;
  /** Design-size assessment outcome, when a design doc has been sized. */
  designSize?: "ok" | "decompose-recommended" | "decompose-required" | null;
  /** Touches Prisma schema / migrations. */
  touchesSchema?: boolean;
  /** Touches routing / core dispatch / inference-routing. */
  touchesRouting?: boolean;
  /** Touches a cross-cutting platform contract (auth, governance, kernel, MCP surface). */
  touchesCoreContract?: boolean;
  /** An archetype/jurisdiction obligation gate matched (a vertical/location duty). */
  archetypeObligation?: boolean;
  /** A customer/business capability surface (not a platform-internal surface). */
  customerBusinessSurface?: boolean;
  /** Confined to a single leaf surface (one component/util), no cross-cutting reach. */
  singleLeafSurface?: boolean;
}

export interface AltitudeVerdict {
  altitude: Altitude;
  basis: AltitudeBasis;
  confidence: AltitudeConfidence;
  /** True when the classification should be confirmed by the operator before the
   *  warrant hardens — always true for the corpus-thin WWWD middle and for
   *  low-confidence ambiguous cases. The confirmation seeds the corpus. */
  needsOperatorConfirm: boolean;
  /** Human-readable structural reasons, for the ledger + reporting. */
  reasons: string[];
}

const TASK_WORKTYPES = new Set(["feature", "bug", "doc", "chore"]);

/** workType values that are architectural by nature regardless of size. */
const ARCHITECTURAL_WORKTYPES = new Set(["refactor", "tool", "skill"]);

/**
 * Classify work altitude from structural signals alone. Deterministic and
 * corpus-free: same signals in → same verdict out. Rules are ordered; the first
 * decisive rule wins, then softer rules and the ambiguous fallback apply.
 */
export function classifyAltitude(s: AltitudeSignals): AltitudeVerdict {
  const reasons: string[] = [];

  // ── Rule 1: WWMD-hard (architectural). Must be right on day one; covered here
  //    because these are unambiguous structural markers of platform-altitude work. ──
  const wwmdMarkers: string[] = [];
  if (s.designSize === "decompose-required") wwmdMarkers.push("design sized decompose-required");
  if (s.effortSize === "xlarge") wwmdMarkers.push("effort xlarge");
  if (s.touchesSchema) wwmdMarkers.push("touches schema/migrations");
  if (s.touchesRouting) wwmdMarkers.push("touches routing/core dispatch");
  if (s.touchesCoreContract) wwmdMarkers.push("touches a cross-cutting platform contract");
  if (s.workType && ARCHITECTURAL_WORKTYPES.has(s.workType) && (s.effortSize === "large" || s.effortSize === "xlarge")) {
    wwmdMarkers.push(`architectural workType '${s.workType}' at ${s.effortSize} effort`);
  }
  if (wwmdMarkers.length > 0) {
    return {
      altitude: "WWMD",
      basis: "structural",
      confidence: "high",
      needsOperatorConfirm: false,
      reasons: wwmdMarkers,
    };
  }

  // ── Rule 2: WSID-hard (task/job). Cheap if slightly wrong; structural defaults. ──
  const isTaskType = s.workType != null && TASK_WORKTYPES.has(s.workType);
  const noCrossCutting = !s.touchesSchema && !s.touchesRouting && !s.touchesCoreContract;
  if (
    s.effortSize === "small" &&
    isTaskType &&
    noCrossCutting &&
    s.singleLeafSurface === true &&
    !s.archetypeObligation &&
    !s.customerBusinessSurface
  ) {
    return {
      altitude: "WSID",
      basis: "structural",
      confidence: "high",
      needsOperatorConfirm: false,
      reasons: [`small ${s.workType} confined to a single leaf surface, no cross-cutting reach`],
    };
  }

  // ── Rule 3: WWWD (business/vertical). Corpus is thin initially → medium
  //    confidence + operator-confirm; each confirmation seeds the WWWD corpus. ──
  if (s.archetypeObligation || s.customerBusinessSurface) {
    if (s.archetypeObligation) reasons.push("carries a vertical/jurisdiction obligation");
    if (s.customerBusinessSurface) reasons.push("customer/business capability surface");
    return {
      altitude: "WWWD",
      basis: "structural",
      confidence: "medium",
      needsOperatorConfirm: true,
      reasons,
    };
  }

  // ── Rule 4: Ambiguous — weak/conflicting signals. Default to the SAFER higher
  //    altitude (never silently WSID a thing we are unsure about) + confirm. ──
  //    Large/medium ambiguous work leans WWMD (governed-interactive is the safe
  //    lane for bigger unknowns); small/unknown ambiguous work sits at WWWD so it
  //    still gets a human confirm and seeds the corpus rather than auto-running. ──
  const leansLarge = s.effortSize === "large" || s.effortSize === "medium";
  return {
    altitude: leansLarge ? "WWMD" : "WWWD",
    basis: "structural",
    confidence: "low",
    needsOperatorConfirm: true,
    reasons: [
      `ambiguous structural signals${s.effortSize ? ` at ${s.effortSize} effort` : ""} — defaulting to the safer higher altitude pending operator confirmation`,
    ],
  };
}

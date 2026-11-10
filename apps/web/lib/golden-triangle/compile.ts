/**
 * EP-GOLDEN-TRIANGLE Slice 1 (BI-8FF4CE21) — pure preference-to-policy compiler.
 *
 * `compileGoldenTrianglePolicy()` turns a human Cost/Quality/Time posture into a
 * DecodedPolicy: a `PostureOverride` (fed into `inferContract()`'s `routeContext`
 * caller-override slot — never a parallel routing pass) plus an
 * `OrchestrationBudget` (persisted as JSON on the receipt path). It is pure and
 * deterministic: no I/O, no Date/random — inputs in, policy out.
 *
 * Invariants (design §0, §5, §7):
 *  - Balanced compiles to NO deltas (cold-start pass-through; equals flag-off).
 *  - Precedence: hard policy > scope/task floor > posture > model availability.
 *  - Hard constraints (residency, tier floor, latency ceiling) clamp the posture
 *    and are recorded as adjustments; residency is never relaxed.
 *  - Fail-closed is a first-class output (state "blocked" | "defer"), not a throw.
 *  - `verificationDepth` is emitted for the shared verification gate and may be
 *    tightened by a hard policy floor; it is never relaxed.
 */
import type { QualityTier } from "../routing/quality-tiers";
import type {
  CompileInput,
  DecodedPolicy,
  GoldenTrianglePreference,
  GoldenTrianglePreset,
  OrchestrationBudget,
  PolicyAdjustment,
  PostureOverride,
} from "./types";

export const GOLDEN_TRIANGLE_COMPILER_VERSION = "0.3.0";
export const GOLDEN_TRIANGLE_PRESET_VERSION = "presets@1";

const VERIFICATION_RANK = { none: 0, shallow: 1, deep: 2 } as const;

function maxVerificationDepth(
  current: OrchestrationBudget["verificationDepth"],
  floor: NonNullable<OrchestrationBudget["verificationDepth"]>,
): NonNullable<OrchestrationBudget["verificationDepth"]> {
  return current && VERIFICATION_RANK[current] >= VERIFICATION_RANK[floor]
    ? current
    : floor;
}

const TIER_RANK: Record<QualityTier, number> = { basic: 0, adequate: 1, strong: 2, frontier: 3 };

// The rigor ladder's top rung: a Quality weight at/above this drags past "review"
// (Assured) into a "debate" (multi-perspective) deliberation. Kept high so only an
// extreme, deliberate Quality posture buys the heaviest pass.
const QUALITY_DEBATE_FLOOR = 0.85;

function tierRank(t: QualityTier): number {
  return TIER_RANK[t];
}

function maxTier(a: QualityTier, b: QualityTier): QualityTier {
  return tierRank(a) >= tierRank(b) ? a : b;
}

interface BasePolicy {
  postureOverride: PostureOverride;
  orchestrationBudget: OrchestrationBudget;
}

/**
 * Canonical preset → policy. Balanced is intentionally empty: it emits no
 * overrides so `inferContract()` produces exactly the platform/task defaults
 * (the cold-start pass-through guarantee).
 */
const PRESET_POLICIES: Record<Exclude<GoldenTrianglePreset, "custom">, BasePolicy> = {
  balanced: { postureOverride: {}, orchestrationBudget: {} },
  assured: {
    postureOverride: { budgetClass: "quality_first", reasoningDepth: "high", effort: "high", minimumTier: "frontier" },
    orchestrationBudget: { verificationDepth: "deep", retryBudget: 3, deliberationPattern: "review" },
  },
  fast: {
    postureOverride: { reasoningDepth: "low", effort: "low", maxLatencyMs: 30_000 },
    orchestrationBudget: { verificationDepth: "none", retryBudget: 1 },
  },
  frugal: {
    postureOverride: { budgetClass: "minimize_cost", reasoningDepth: "low", effort: "low", minimumTier: "adequate" },
    orchestrationBudget: { verificationDepth: "shallow", retryBudget: 1 },
  },
};

function cloneBase(b: BasePolicy): BasePolicy {
  return {
    postureOverride: { ...b.postureOverride },
    orchestrationBudget: { ...b.orchestrationBudget },
  };
}

function normalizeWeights(p: GoldenTrianglePreference): { cost: number; quality: number; time: number } {
  const c = Math.max(0, p.costWeight);
  const q = Math.max(0, p.qualityWeight);
  const t = Math.max(0, p.timeWeight);
  const sum = c + q + t;
  if (sum <= 0) return { cost: 1 / 3, quality: 1 / 3, time: 1 / 3 };
  return { cost: c / sum, quality: q / sum, time: t / sum };
}

/**
 * Custom posture: snap to the dominant axis (moderate vs strong intensity), or
 * Balanced when no axis is clearly preferred. v1 keeps this deterministic and
 * discrete; finer soft-blending is a future refinement (design §3).
 */
function deriveCustomPolicy(p: GoldenTrianglePreference): BasePolicy {
  const w = normalizeWeights(p);
  // Pick the dominant axis without array indexing; ties favour quality, then cost.
  let axis: "quality" | "cost" | "time" = "quality";
  let weight = w.quality;
  if (w.cost > weight) {
    axis = "cost";
    weight = w.cost;
  }
  if (w.time > weight) {
    axis = "time";
    weight = w.time;
  }

  if (weight < 0.4) return cloneBase(PRESET_POLICIES.balanced);
  const strong = weight >= 0.55;

  if (axis === "quality") {
    // The top rung of the rigor ladder: an extreme Quality posture buys not just a
    // frontier model at max effort but a DEBATE pass (multi-perspective), above the
    // single review the Assured preset buys. (See the work-orchestration design.)
    if (weight >= QUALITY_DEBATE_FLOOR) {
      return {
        postureOverride: { budgetClass: "quality_first", reasoningDepth: "high", effort: "max", minimumTier: "frontier" },
        orchestrationBudget: { verificationDepth: "deep", retryBudget: 3, deliberationPattern: "debate" },
      };
    }
    return strong
      ? cloneBase(PRESET_POLICIES.assured)
      : {
          postureOverride: { budgetClass: "quality_first", reasoningDepth: "medium", effort: "medium", minimumTier: "strong" },
          orchestrationBudget: { verificationDepth: "shallow", retryBudget: 2, deliberationPattern: "review" },
        };
  }
  if (axis === "cost") {
    return strong
      ? cloneBase(PRESET_POLICIES.frugal)
      : {
          postureOverride: { budgetClass: "minimize_cost", reasoningDepth: "low", effort: "low", minimumTier: "adequate" },
          orchestrationBudget: { verificationDepth: "shallow", retryBudget: 1 },
        };
  }
  // time
  return strong
    ? cloneBase(PRESET_POLICIES.fast)
    : {
        postureOverride: { reasoningDepth: "low", effort: "low", maxLatencyMs: 60_000 },
        orchestrationBudget: { verificationDepth: "none", retryBudget: 1 },
      };
}

function basePolicyFor(p: GoldenTrianglePreference): BasePolicy {
  if (p.preset === "custom") return deriveCustomPolicy(p);
  return cloneBase(PRESET_POLICIES[p.preset]);
}

/**
 * EP-WORK-POSTURE (BI-B32E8C32) — `taskClass` stops being a dead input.
 *
 * It has been a REQUIRED field on CompileInput since Slice 1, threaded through
 * every caller, and never read: compiling with different task classes returned
 * byte-identical policy, and every live caller passed the literal
 * "conversation". The "what kind of work is this" slot the design called for
 * already existed and did nothing.
 *
 * The carrier is the room's collaboration shape (design §4), so this table is
 * keyed by the same vocabulary as WORKROOM_SHAPE_KEYS rather than a second one.
 * Every entry can only TIGHTEN — raise a tier floor, deepen verification — so a
 * task class can never buy a cheaper or less-checked run than the posture asked
 * for. An unrecognised class contributes nothing, which keeps the default
 * "conversation" byte-identical to flag-off.
 */
const TASK_CLASS_FLOORS: Record<string, { minimumTier?: QualityTier; verificationDepth?: OrchestrationBudget["verificationDepth"] }> = {
  // The action leaves the business under its own name.
  "outward-review": { minimumTier: "strong", verificationDepth: "deep" },
  // An accountable approver signs off on prepared evidence.
  "approval-sign-off": { minimumTier: "strong", verificationDepth: "shallow" },
  // A consequential change confirmed before execution.
  "change-consequential": { minimumTier: "strong" },
};

function applyTaskClassFloor(
  taskClass: string,
  posture: PostureOverride,
  budget: OrchestrationBudget,
  adjustments: PolicyAdjustment[],
): void {
  const floor = TASK_CLASS_FLOORS[taskClass];
  if (!floor) return;

  if (floor.minimumTier) {
    const raised = posture.minimumTier
      ? maxTier(posture.minimumTier, floor.minimumTier)
      : floor.minimumTier;
    if (raised !== posture.minimumTier) {
      adjustments.push({
        field: "minimumTier",
        from: posture.minimumTier,
        to: raised,
        reasonCode: "task_class_tier_floor",
        reason: `Minimum tier raised to ${raised} by the kind of work (${taskClass}).`,
      });
      posture.minimumTier = raised;
    }
  }

  if (floor.verificationDepth) {
    const current = budget.verificationDepth;
    const deeper = maxVerificationDepth(current, floor.verificationDepth);
    if (deeper !== current) {
      adjustments.push({
        field: "verificationDepth",
        from: current,
        to: deeper,
        reasonCode: "task_class_verification_floor",
        reason: `Verification deepened to ${deeper} by the kind of work (${taskClass}).`,
      });
      budget.verificationDepth = deeper;
    }
  }
}

function buildExplanation(
  preset: GoldenTrianglePreset,
  posture: PostureOverride,
  budget: OrchestrationBudget,
  adjustments: PolicyAdjustment[],
  state: DecodedPolicy["state"],
): string {
  const label = preset === "custom" ? "Custom" : preset.charAt(0).toUpperCase() + preset.slice(1);
  const parts: string[] = [];
  if (posture.minimumTier) parts.push(`${posture.minimumTier} tier`);
  if (posture.effort) parts.push(`${posture.effort} effort`);
  if (posture.budgetClass) parts.push(posture.budgetClass.replace(/_/g, " "));
  if (budget.verificationDepth && budget.verificationDepth !== "none") parts.push(`${budget.verificationDepth} verification`);
  if (budget.deliberationPattern) parts.push(`${budget.deliberationPattern} deliberation`);

  const bits: string[] = [
    parts.length ? `${label} → ${parts.join(", ")}.` : `${label} → platform defaults (no overrides).`,
  ];
  if (adjustments.length) bits.push(`Adjusted: ${adjustments.map((a) => a.reason).join(" ")}`);
  if (state === "defer") bits.push("Deferred: no governed route available right now.");
  if (state === "blocked") bits.push("Blocked: hard constraints cannot be satisfied.");
  return bits.join(" ");
}

export function compileGoldenTrianglePolicy(input: CompileInput): DecodedPolicy {
  const { preference, policyConstraints, modelAvailability } = input;
  const base = basePolicyFor(preference);
  const posture = base.postureOverride;
  const budget = base.orchestrationBudget;
  const adjustments: PolicyAdjustment[] = [];
  let state: DecodedPolicy["state"] = "ok";

  // BI-B32E8C32: the kind of work raises floors before any hard clamp applies,
  // so a policy clamp still wins over it — the precedence the design states.
  applyTaskClassFloor(input.taskClass, posture, budget, adjustments);

  // ── Hard constraint: residency (never relaxed) ──
  if (policyConstraints?.residency && posture.residencyPolicy !== policyConstraints.residency) {
    adjustments.push({
      field: "residencyPolicy",
      from: posture.residencyPolicy,
      to: policyConstraints.residency,
      reasonCode: "residency_clamp",
      reason: `Residency forced to ${policyConstraints.residency} by policy; posture cannot relax it.`,
    });
    posture.residencyPolicy = policyConstraints.residency;
  }

  // ── Floor: minimum tier (posture cannot drop below the task/agent floor) ──
  if (policyConstraints?.minimumTierFloor) {
    const floor = policyConstraints.minimumTierFloor;
    const current = posture.minimumTier;
    const raised = current ? maxTier(current, floor) : floor;
    if (raised !== current) {
      adjustments.push({
        field: "minimumTier",
        from: current,
        to: raised,
        reasonCode: "tier_floor",
        reason: `Minimum tier raised to ${raised} by the task/agent floor.`,
      });
      posture.minimumTier = raised;
    }
  }

  // ── Floor: verification depth (stake policy cannot be relaxed by posture) ──
  if (policyConstraints?.verificationDepthFloor) {
    const floor = policyConstraints.verificationDepthFloor;
    const current = budget.verificationDepth;
    const deeper = maxVerificationDepth(current, floor);
    if (deeper !== current) {
      adjustments.push({
        field: "verificationDepth",
        from: current,
        to: deeper,
        reasonCode: "verification_depth_floor",
        reason: `Verification deepened to ${deeper} by the policy floor.`,
      });
      budget.verificationDepth = deeper;
    }
  }

  // ── Ceiling: max latency (posture cannot exceed the policy ceiling) ──
  if (policyConstraints?.maxLatencyCeilingMs !== undefined) {
    const ceil = policyConstraints.maxLatencyCeilingMs;
    if (posture.maxLatencyMs === undefined || posture.maxLatencyMs > ceil) {
      adjustments.push({
        field: "maxLatencyMs",
        from: posture.maxLatencyMs,
        to: ceil,
        reasonCode: "latency_ceiling",
        reason: `Max latency clamped to ${ceil}ms by policy.`,
      });
      posture.maxLatencyMs = ceil;
    }
  }

  // ── Model availability: clamp the requested tier to what's reachable ──
  if (modelAvailability) {
    const hardFloor = policyConstraints?.minimumTierFloor;
    if (!modelAvailability.healthy || modelAvailability.tiers.length === 0) {
      state = "defer";
      adjustments.push({
        field: "state",
        from: "ok",
        to: "defer",
        reasonCode: "no_models_available",
        reason: "No healthy models available; deferring rather than routing to an unsafe path.",
      });
    } else if (posture.minimumTier) {
      const requested = posture.minimumTier;
      const tiers = modelAvailability.tiers;
      const meetsRequested = tiers.some((t) => tierRank(t) >= tierRank(requested));
      if (!meetsRequested) {
        const hardFloorUnmet = hardFloor !== undefined && !tiers.some((t) => tierRank(t) >= tierRank(hardFloor));
        if (hardFloorUnmet) {
          state = "blocked";
          adjustments.push({
            field: "state",
            from: "ok",
            to: "blocked",
            reasonCode: "tier_floor_unmet",
            reason: `No available model meets the required minimum tier (${hardFloor}).`,
          });
        } else {
          let best: QualityTier = requested;
          let found = false;
          for (const t of tiers) {
            if (!found || tierRank(t) > tierRank(best)) {
              best = t;
              found = true;
            }
          }
          adjustments.push({
            field: "minimumTier",
            from: requested,
            to: best,
            reasonCode: "tier_clamp_availability",
            reason: `Requested tier unavailable; clamped to the best reachable tier (${best}).`,
          });
          posture.minimumTier = best;
        }
      }
    }
  }

  return {
    postureOverride: posture,
    orchestrationBudget: budget,
    adjustments,
    state,
    explanation: buildExplanation(preference.preset, posture, budget, adjustments, state),
    compilerVersion: GOLDEN_TRIANGLE_COMPILER_VERSION,
    presetVersion: GOLDEN_TRIANGLE_PRESET_VERSION,
  };
}

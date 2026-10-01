// apps/web/lib/build/plan-to-build-transition-core.ts
//
// The dependency-leaf half of lib/build/plan-to-build-transition.ts: the
// plan→build gate profiles and the one transition function. It is a separate
// file only so that callers inside the MCP tool-pack graph (save_phase_handoff)
// can import it without joining apps/web's import cycle
// (scripts/check-no-web-import-cycle-growth.mjs) or adding a build → mcp edge
// (scripts/check-application-boundaries.mjs): it imports only the database
// client, and the caller hands in its activity logger. It is not a second
// transition: plan-to-build-transition.ts re-exports everything here and
// performPlanToBuildTransition calls this function like every other path.

import { prisma } from "@dpf/db";

// ── GPP C-8: one plan→build transition function (PR-F, BI-45F9CB7A) ─────────
//
// Five code paths move a build from `plan` to `build`. Before PR-F four of them
// wrote the phase themselves, each with its own gate set, so a missing gate
// (the WWMD plan-advancement gate on `save_phase_handoff`) was invisible except
// by reading every caller. Now every path calls `transitionPlanToBuild`, which
// owns the gate ORDER, the phase write and the gate-skipped record, and each
// path's differences are declared once, in `PLAN_TO_BUILD_GATE_PROFILES` below.
//
// This is a defect-fix refactor with STRICT behaviour preservation: every path
// keeps exactly its gate set, order, modes, refusal forms, activity entries and
// side effects (pinned by the *.characterization.test.ts files beside each
// caller). The gate BODIES stay with their callers, because their inputs and
// refusal shapes differ (a returned value, a thrown error, an HTTP 422, a soft
// tool message). Unifying the gate sets is a separate, recorded decision; the
// first candidate is enforcing WWMD on `save_phase_handoff` once the PR-B
// `gpp-c8-transition-gate-skipped` shadow evidence is reviewed.
//
// `lib/gpp/direct-phase-writes-ratchet.test.ts` fails if a new `phase: "build"`
// write appears outside this file.

/** The declared plan→build gate set (GPP C-8). Every path declares a mode for each. */
export const PLAN_TO_BUILD_GATE_SET = [
  "initiative-readiness",
  "structural-phase-gate",
  "dependency-gate",
  "wwmd-plan-advancement",
] as const;
export type PlanToBuildGate = (typeof PLAN_TO_BUILD_GATE_SET)[number];

/**
 * Path-local checks that already sit between the declared gates on one path.
 * They are named steps, not hidden code, so the order on each path is readable
 * from its profile.
 */
export type PlanToBuildPathCheck =
  | "escalation-tracker"
  | "build-studio-decision-record"
  | "autonomous-eligibility"
  | "build-branch-init";
export type PlanToBuildStep = PlanToBuildGate | PlanToBuildPathCheck;

/**
 * How a path treats the WWMD plan-advancement gate.
 * - `blocking`: evaluated; a refusal stops the transition; an evaluator error
 *   propagates (no fail-open).
 * - `autonomous-mode`: evaluated; behaviour follows `DPF_BUILD_AUTONOMOUS_PLAYBOOK_MODE`:
 *   `off` and `enforce` stop on a refusal; `shadow` logs `autonomous_playbook_shadow`
 *   and proceeds. An evaluator error fails open except under `enforce`.
 * - `not-evaluated-recorded`: not called (calling it writes DecisionInteraction
 *   rows and starts voice synthesis, so it cannot run as a shadow); the skip is
 *   recorded as `gpp-c8-transition-gate-skipped` after the write (PR-B).
 * - `not-evaluated`: not called and not recorded at this path.
 */
export type PlanToBuildWwmdMode =
  | "blocking"
  | "autonomous-mode"
  | "not-evaluated-recorded"
  | "not-evaluated";

/**
 * Per-gate mode on one path.
 * - `blocking`: evaluated here; a refusal stops the transition.
 * - `blocking-soft`: evaluated here; a refusal stops the transition but the
 *   caller still reports success (the handoff itself was saved).
 * - `autonomous-mode`: see `PlanToBuildWwmdMode`.
 * - `upstream`: not evaluated at the transition, but earlier in the same flow.
 * - `not-evaluated` / `not-evaluated-recorded`: see `PlanToBuildWwmdMode`.
 */
export type PlanToBuildGateMode =
  | "blocking"
  | "blocking-soft"
  | "autonomous-mode"
  | "upstream"
  | "not-evaluated"
  | "not-evaluated-recorded";

export type PlanToBuildPath =
  | "advance-build-phase"
  | "advance-phase-route"
  | "perform-plan-to-build-transition"
  | "save-phase-handoff"
  | "build-on-plan-approval";

export type PlanToBuildGateProfile = {
  /** Where the path enters, for humans and the single-path test. */
  readonly entryPoint: string;
  readonly wwmdMode: PlanToBuildWwmdMode;
  readonly gates: Readonly<Record<PlanToBuildGate, PlanToBuildGateMode>>;
  /** Steps the transition evaluates, in order. The phase write follows the last. */
  readonly steps: readonly PlanToBuildStep[];
  /** Checks the caller runs before calling the transition (unchanged by PR-F). */
  readonly callerChecksBefore: readonly string[];
  /** How a refusal reaches the caller's caller. */
  readonly refusal: string;
  /** Side effects that stay with the caller, after the write. */
  readonly callerEffectsAfter: readonly string[];
  /** Activity summary for `not-evaluated-recorded`; absent otherwise. */
  readonly gateSkippedSummary?: string;
};

/** Activity tool name for a recorded WWMD skip (PR-B; AC-C8-SHADOW). */
export const PLAN_TO_BUILD_GATE_SKIPPED_EVENT = "gpp-c8-transition-gate-skipped";

/**
 * The five plan→build paths and their CURRENT gate behaviour. Read this table to
 * see where the paths differ. Changing a row changes Build Studio behaviour and
 * needs its own recorded decision; PR-F only made the rows explicit.
 */
export const PLAN_TO_BUILD_GATE_PROFILES = {
  "advance-build-phase": {
    entryPoint: "lib/actions/build.ts advanceBuildPhase (Build Studio UI)",
    wwmdMode: "blocking",
    gates: {
      "initiative-readiness": "blocking",
      "structural-phase-gate": "blocking",
      "dependency-gate": "blocking",
      "wwmd-plan-advancement": "blocking",
    },
    steps: [
      "initiative-readiness",
      "structural-phase-gate",
      "dependency-gate",
      "build-studio-decision-record",
      "wwmd-plan-advancement",
    ],
    callerChecksBefore: ["build owner", "Approve Start", "canTransitionPhase"],
    refusal:
      "Initiative readiness and the structural gate return { ok: false, message }; the dependency and WWMD gates throw. " +
      "A UX-only structural refusal passes when the operator gives an override reason (>= 10 chars), recorded as ux-override.",
    callerEffectsAfter: [
      "revalidate portal context",
      "ephemeral ship tokens",
      "phase:change event",
      "PhaseHandoff document",
      "calendar milestone",
      "autoExecuteBuild",
    ],
  },
  "advance-phase-route": {
    entryPoint: "app/api/agent/build/advance-phase/route.ts POST (manual admin advance)",
    wwmdMode: "blocking",
    gates: {
      "initiative-readiness": "not-evaluated",
      "structural-phase-gate": "blocking",
      "dependency-gate": "not-evaluated",
      "wwmd-plan-advancement": "blocking",
    },
    steps: ["structural-phase-gate", "wwmd-plan-advancement"],
    callerChecksBefore: ["view_platform", "Approve Start", "canTransitionPhase"],
    refusal: "HTTP 422: the structural gate returns { error, gate }; WWMD returns { error, decisionInteraction }.",
    callerEffectsAfter: ["phase:change event", "phase:advance activity (\"Phase manually advanced\")"],
  },
  "perform-plan-to-build-transition": {
    entryPoint:
      "lib/build/plan-to-build-transition.ts performPlanToBuildTransition (reviewBuildPlan, pre-build resume reconciler)",
    wwmdMode: "autonomous-mode",
    gates: {
      "initiative-readiness": "blocking",
      "structural-phase-gate": "blocking",
      "dependency-gate": "blocking",
      "wwmd-plan-advancement": "autonomous-mode",
    },
    steps: [
      "initiative-readiness",
      "escalation-tracker",
      "structural-phase-gate",
      "dependency-gate",
      "wwmd-plan-advancement",
      "autonomous-eligibility",
      "build-branch-init",
    ],
    callerChecksBefore: ["build exists and is in plan"],
    refusal:
      "Returns a PlanToBuildTransitionOutcome and never throws. An unsatisfiable dependency abandons the build; " +
      "a branch-init failure is counted and escalates past the threshold.",
    callerEffectsAfter: [
      "phase:change event (with a thread)",
      "phase:advance activity",
      "clear the plan-advance tracker",
      "dispatch the build orchestrator",
    ],
  },
  "save-phase-handoff": {
    entryPoint: "lib/mcp/packs/build-evidence-extra-pack.ts save_phase_handoff auto-advance (coworker tool)",
    wwmdMode: "not-evaluated-recorded",
    gates: {
      "initiative-readiness": "not-evaluated",
      "structural-phase-gate": "blocking-soft",
      "dependency-gate": "not-evaluated",
      "wwmd-plan-advancement": "not-evaluated-recorded",
    },
    steps: ["structural-phase-gate"],
    callerChecksBefore: ["auto-advance requested", "canTransitionPhase"],
    refusal:
      "Soft: the tool returns success: true with \"Phase handoff saved but gate blocked advance: <reason>\". " +
      "The structural gate result is recorded on the PhaseHandoff row either way.",
    callerEffectsAfter: ["phase:change event", "phase:advance activity"],
    gateSkippedSummary:
      "plan → build advanced by save_phase_handoff without the WWMD plan-advancement gate (shadow; not enforced)",
  },
  "build-on-plan-approval": {
    entryPoint:
      "lib/build/build-on-plan-approval.ts dispatchBuildForApprovedPlan (fallback write after start_build; admin dispatch test route)",
    wwmdMode: "not-evaluated",
    gates: {
      // dispatchBuildForApprovedPlan checks readiness while the build is in plan,
      // and start_build checks readiness and dependencies before setting buildBranch.
      "initiative-readiness": "upstream",
      "structural-phase-gate": "not-evaluated",
      "dependency-gate": "upstream",
      "wwmd-plan-advancement": "not-evaluated",
    },
    steps: [],
    callerChecksBefore: ["initiative readiness", "start_build succeeded", "phase is plan and buildBranch is set"],
    refusal: "None at the transition: the caller only calls it when start_build has set buildBranch.",
    callerEffectsAfter: ["build_dispatch activity", "build orchestrator run"],
  },
} as const satisfies Record<PlanToBuildPath, PlanToBuildGateProfile>;

type PlanToBuildProfiles = typeof PLAN_TO_BUILD_GATE_PROFILES;
/** The steps a given path must supply, derived from its profile. */
export type PlanToBuildStepsOf<P extends PlanToBuildPath> = PlanToBuildProfiles[P]["steps"][number];

export type PlanToBuildStepResult<R> = { readonly pass: true } | { readonly pass: false; readonly refusal: R };
export const PLAN_TO_BUILD_PASS = { pass: true } as const;
export function refusePlanToBuild<R>(refusal: R): { readonly pass: false; readonly refusal: R } {
  return { pass: false, refusal };
}

/** The caller's build-activity logger (lib/mcp/build-tool-helpers `logBuildActivity`). */
export type PlanToBuildActivityLogger = (buildId: string, tool: string, summary: string) => void;
/** A path that records a WWMD skip must hand in the logger; no other path may. */
type PlanToBuildLoggerArg<P extends PlanToBuildPath> =
  PlanToBuildProfiles[P]["wwmdMode"] extends "not-evaluated-recorded"
    ? { logActivity: PlanToBuildActivityLogger }
    : { logActivity?: never };

export type PlanToBuildTransitionResult<P extends PlanToBuildPath, R> =
  | { kind: "advanced" }
  | { kind: "refused"; step: PlanToBuildStepsOf<P>; refusal: R };

/**
 * The one plan→build transition. Runs the path's declared steps in its declared
 * order (each step is supplied by the caller and either passes, returns a
 * refusal, or throws, exactly as that caller's code did before), then
 * `beforeWrite`, then the phase write, then, for `not-evaluated-recorded`, the
 * gate-skipped record. It reads nothing itself and adds no gate.
 */
export async function transitionPlanToBuild<P extends PlanToBuildPath, R = never>(args: {
  buildId: string;
  path: P;
  steps: { readonly [K in PlanToBuildStepsOf<P>]: () => PlanToBuildStepResult<R> | Promise<PlanToBuildStepResult<R>> };
  beforeWrite?: () => void | Promise<void>;
} & PlanToBuildLoggerArg<P>): Promise<PlanToBuildTransitionResult<P, R>> {
  const { buildId, path, steps, beforeWrite } = args;
  const profile: PlanToBuildGateProfile = PLAN_TO_BUILD_GATE_PROFILES[path];
  for (const step of profile.steps as readonly PlanToBuildStepsOf<P>[]) {
    const result = await steps[step]();
    if (!result.pass) return { kind: "refused", step, refusal: result.refusal };
  }
  if (beforeWrite) await beforeWrite();
  await prisma.featureBuild.update({ where: { buildId }, data: { phase: "build" } });
  if (profile.wwmdMode === "not-evaluated-recorded" && profile.gateSkippedSummary) {
    (args as { logActivity: PlanToBuildActivityLogger }).logActivity(
      buildId,
      PLAN_TO_BUILD_GATE_SKIPPED_EVENT,
      profile.gateSkippedSummary,
    );
  }
  return { kind: "advanced" };
}

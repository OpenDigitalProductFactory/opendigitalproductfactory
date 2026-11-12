/** BI-D37B2C13, approved Phase5b: an offline description, never a runtime driver.
 * Founder Option B: DI-119FB3749D46. No execution or approval policy is changed.
 */
import {
  BUILD_PROCESS_SIZES, BUILD_PROCESS_TYPE_VALUES, DELIVERABLE_SENSITIVITIES,
  getProcessPolicy, type GateRequirement,
} from "@/lib/explore/build-process-matrix";
import {
  PLAN_TO_BUILD_GATE_PROFILES, PLAN_TO_BUILD_GATE_SET,
  type PlanToBuildGateMode, type PlanToBuildGateProfile,
} from "@/lib/build/plan-to-build-transition-core";
import { sandboxPhases } from "@/lib/gpp/sandbox-dispatch-sites";
import type { WorkShapeEvidenceKind } from "@dpf/validators/gpp/work-vocabulary";
import type { BuildPhase } from "@/lib/explore/feature-build-types";

export const BUILD_STUDIO_EVIDENCE_MAP: Readonly<Record<GateRequirement, WorkShapeEvidenceKind | null>> = {
  "designDoc-present": "design-doc",
  "designReview-passed": "architecture-review-receipt",
  "designReview-not-failed-if-present": "architecture-review-receipt",
  "fixContext-complete": null,
  "buildPlan-present": "plan-doc",
  "planReview-passed": "plan-review-receipt",
  "verification-typecheck-passed": "passing-test",
  "verification-depth-satisfied": null,
  "acceptance-evaluated": "acceptance-receipt",
  "acceptance-all-met-if-array": "acceptance-receipt",
  "uxVerification-not-blocking": "ux-verified",
  "happyPathIntake-ready": null,
};

export const PLAN_TO_BUILD_MODE_RANK: Readonly<Record<PlanToBuildGateMode, number>> = {
  blocking: 5, "blocking-soft": 5, "autonomous-mode": 4,
  upstream: 3, "not-evaluated-recorded": 2, "not-evaluated": 1,
};
export const CANONICAL_PLAN_TO_BUILD_PRECONDITIONS = PLAN_TO_BUILD_GATE_PROFILES["advance-build-phase"].callerChecksBefore;

type Profiles = Readonly<Record<string, PlanToBuildGateProfile>>;
export type PlanDivergence = {
  path: string; gate: string; kind: "weaker-gate" | "missing-precondition" | "reporting-only";
  mode?: PlanToBuildGateMode; canonical?: PlanToBuildGateMode; backlogItem: string;
};

/** Reads current profiles; a skipped gate cannot disappear into a handwritten table. */
export function planToBuildDivergences(profiles: Profiles = PLAN_TO_BUILD_GATE_PROFILES): PlanDivergence[] {
  const canonical = profiles["advance-build-phase"]!;
  const rows: PlanDivergence[] = [];
  for (const [path, profile] of Object.entries(profiles)) {
    for (const gate of PLAN_TO_BUILD_GATE_SET) {
      const mode = profile.gates[gate];
      const expected = canonical.gates[gate];
      if (PLAN_TO_BUILD_MODE_RANK[mode] < PLAN_TO_BUILD_MODE_RANK[expected]) {
        rows.push({ path, gate, kind: "weaker-gate", mode, canonical: expected,
          backlogItem: path === "save-phase-handoff" && gate === "wwmd-plan-advancement" ? "BI-5D59A982" : "BI-D37B2C13" });
      } else if (mode === "blocking-soft" && expected === "blocking") {
        rows.push({ path, gate, kind: "reporting-only", mode, canonical: expected, backlogItem: "BI-BDB63485" });
      }
    }
    for (const check of canonical.callerChecksBefore) {
      if (!profile.callerChecksBefore.includes(check)) {
        rows.push({ path, gate: check, kind: "missing-precondition", backlogItem: path === "save-phase-handoff" ? "BI-BDB63485" : "BI-D37B2C13" });
      }
    }
  }
  return rows;
}

/** Exhaustive sandbox-pack classification. Conformance refuses an unclassified tool. */
export const SANDBOX_TOOL_CLASS = {
  get_build_sandbox_state: "read", diagnose_sandbox: "read", check_sandbox: "read",
  read_sandbox_file: "read", search_sandbox: "read", list_sandbox_files: "read",
  recover_sandbox: "lifecycle", start_sandbox: "lifecycle",
  run_sandbox_tests: "act", write_sandbox_file: "act", edit_sandbox_file: "act", run_sandbox_command: "act",
} as const satisfies Record<string, "read" | "act" | "lifecycle">;

// All acting sandbox-pack tools currently carry build/review tags. Tests check
// this declaration against the real pack; dispatch phases come from its ratchet.
export function sandboxActingPhases(): ReadonlySet<BuildPhase> { return new Set(["build", "review"]); }
export const BUILD_STUDIO_SANDBOX_STAGES: ReadonlySet<BuildPhase> = new Set([...sandboxPhases(), ...sandboxActingPhases()]);

/** Default cell and all policy variants are reviewable, offline facts. */
export function lifecycleVariantDeltas() {
  const baseline = getProcessPolicy("feature", "medium");
  const variants = [
    { variant: "base", options: undefined },
    { variant: "qualityFirst", options: { qualityFirst: true } },
    ...DELIVERABLE_SENSITIVITIES.map((sensitivity) => ({ variant: sensitivity, options: { sensitivity } })),
  ];
  return BUILD_PROCESS_TYPE_VALUES.flatMap((type) => BUILD_PROCESS_SIZES.flatMap((size) =>
    variants.map(({ variant, options }) => {
      const policy = getProcessPolicy(type, size, options);
      return {
        type, size, variant,
        skippedPhases: baseline.phases.filter((phase) => !policy.phases.includes(phase)),
        gates: Object.fromEntries(Object.keys(baseline.gates).map((key) => {
          const transition = key as keyof typeof baseline.gates;
          const original = baseline.gates[transition] ?? [];
          const current = policy.gates[transition] ?? [];
          return [transition, { added: current.filter((gate) => !original.includes(gate)), removed: original.filter((gate) => !current.includes(gate)) }] as const;
        }).filter(([,delta]) => delta.added.length > 0 || delta.removed.length > 0)),
      };
    }),
  ));
}

export const BUILD_STUDIO_CONFIG_DEPENDENT_GATES = [
  { gate: "ideate-start", source: "lib/build/ideate-on-approval.ts", off: "not-evaluated", shadow: "advisory", enforce: "blocking" },
  { gate: "ship", source: "lib/build/ship-on-review-approval.ts", off: "not-evaluated", shadow: "advisory", enforce: "blocking" },
] as const;

export const BUILD_STUDIO_RECORDED_BOUNDARIES = {
  declaredReach: "coworker phase tags",
  pipelineReach: "untagged tools may be available during build; not the declared capability set",
  externalReach: "external MCP has no buildPhases filter; BI-BDB63485",
  readiness: "delivery shapes gate entry; this declared flow describes existing execution and cannot dispatch it",
  residualRisks: ["Sandbox network egress is not contained by the declaration", "Shared AUTH_SECRET: BI-F1C680C7"],
} as const;

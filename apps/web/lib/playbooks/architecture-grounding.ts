export type GovernedAdaptivePlaybookElementType =
  | "action"
  | "requirement"
  | "state_machine"
  | "verification_case";

export type GovernedAdaptivePlaybookImplementationStatus = "implemented" | "planned";

export type GovernedAdaptivePlaybookGroundingElement = {
  elementId: string;
  elementType: GovernedAdaptivePlaybookElementType;
  name: string;
  description: string;
  implementationStatus: GovernedAdaptivePlaybookImplementationStatus;
  itValueStreams: string[];
  verificationCaseId?: string;
  sysml_allocates: string[];
};

export const GOVERNED_ADAPTIVE_PLAYBOOKS_GROUNDING: GovernedAdaptivePlaybookGroundingElement[] = [
  {
    elementId: "REQ-GAP-slice-1-observer",
    elementType: "requirement",
    name: "Systemic Capability Needs Observer",
    description:
      "Observe repeated coworker evidence and emit reviewable capability needs without activating skills, prompts, grants, routes, policies, code, or Work Case state.",
    implementationStatus: "implemented",
    itValueStreams: ["operate"],
    verificationCaseId: "VC-GAP-observer",
    sysml_allocates: [
      "apps/web/lib/tak/pattern-observer/observer.ts",
      "apps/web/lib/tak/pattern-observer/classifiers.ts",
      "apps/web/lib/tak/pattern-observer/fingerprint.ts",
      "apps/web/lib/tak/pattern-observer/core.ts",
    ],
  },
  {
    elementId: "ACT-GAP-observe",
    elementType: "action",
    name: "Observe Governed Adaptive Playbook Signals",
    description:
      "Collect recent TaskRun and ToolExecution evidence, classify systemic grant, context-economy, and repeated-success signals, dedupe them, and submit one coworker self-assessment.",
    implementationStatus: "implemented",
    itValueStreams: ["operate"],
    verificationCaseId: "VC-GAP-observer",
    sysml_allocates: [
      "apps/web/lib/tak/pattern-observer/observer.ts",
      "apps/web/lib/tak/pattern-observer/classifiers.ts",
      "apps/web/lib/tak/pattern-observer/fingerprint.ts",
      "apps/web/lib/tak/pattern-observer/core.ts",
    ],
  },
  {
    elementId: "VC-GAP-observer",
    elementType: "verification_case",
    name: "Verify Systemic Capability Needs Observer",
    description:
      "Unit-level verification that the observer files correctly-kind capability needs, preserves loop guards, dedupes within a sweep, and remains proposal-only.",
    implementationStatus: "implemented",
    itValueStreams: ["operate"],
    sysml_allocates: [
      "apps/web/lib/tak/pattern-observer/observer.test.ts",
      "apps/web/lib/tak/pattern-observer/classifiers.test.ts",
      "apps/web/lib/tak/pattern-observer/fingerprint.test.ts",
      "apps/web/lib/tak/pattern-observer/core.test.ts",
      "apps/web/lib/tak/reflection-triggers.test.ts",
    ],
  },
  {
    elementId: "SM-GAP-PROMOTION",
    elementType: "state_machine",
    name: "Governed Adaptive Playbook Promotion Ladder",
    description:
      "Observed to candidate to approved to active to retired promotion ladder for adaptive playbooks; activation and case-staged promotion land in later slices.",
    implementationStatus: "planned",
    itValueStreams: ["operate"],
    sysml_allocates: [],
  },
];

export function findGovernedAdaptivePlaybookElement(
  elementId: string,
): GovernedAdaptivePlaybookGroundingElement | undefined {
  return GOVERNED_ADAPTIVE_PLAYBOOKS_GROUNDING.find(
    (element) => element.elementId === elementId,
  );
}

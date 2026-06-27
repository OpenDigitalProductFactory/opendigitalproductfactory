export type WorkCaseArchitectureElementType =
  | "requirement"
  | "action"
  | "part_definition"
  | "interface_definition"
  | "verification_case"
  | "state_machine";

export type WorkCaseItValueStream =
  | "operate"
  | "consume"
  | "integrate"
  | "deploy"
  | "release";

export interface WorkCaseArchitectureElement {
  elementId: string;
  elementType: WorkCaseArchitectureElementType;
  name: string;
  description: string;
  implementationStatus: "implemented" | "partially-implemented" | "planned";
  itValueStreams: readonly WorkCaseItValueStream[];
  verificationCaseId?: string;
}

export interface WorkCaseArchitectureAllocation {
  sourceElementId: string;
  relationshipType: "sysml_allocates";
  targetKind: "source_file";
  targetRef: string;
}

export const WORK_CASE_ARCHITECTURE_ELEMENTS = [
  {
    elementId: "REQ-WC-1",
    elementType: "requirement",
    name: "Governed write path",
    description: "Consequential Work Case transitions mutate only through governed Actions.",
    implementationStatus: "planned",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
    verificationCaseId: "VC-WC-1",
  },
  {
    elementId: "REQ-WC-2",
    elementType: "requirement",
    name: "Receipt coverage and sealing",
    description: "Every consequential transition emits a receipt and terminal cases are sealed.",
    implementationStatus: "planned",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
    verificationCaseId: "VC-WC-2",
  },
  {
    elementId: "REQ-WC-3",
    elementType: "requirement",
    name: "Accountable identity",
    description: "An agent actor without a named sponsor cannot transition a Work Case.",
    implementationStatus: "planned",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
    verificationCaseId: "VC-WC-3",
  },
  {
    elementId: "REQ-WC-4",
    elementType: "requirement",
    name: "A2A lifecycle alignment",
    description: "Case states and handoff verbs map to the A2A lifecycle including pause states.",
    implementationStatus: "partially-implemented",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
    verificationCaseId: "VC-WC-4",
  },
  {
    elementId: "REQ-WC-5",
    elementType: "requirement",
    name: "Decision routing",
    description: "Consequential Work Case decisions route through DecisionInteraction.",
    implementationStatus: "planned",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
    verificationCaseId: "VC-WC-5",
  },
  {
    elementId: "SM-WC-LIFECYCLE",
    elementType: "state_machine",
    name: "Work Case lifecycle",
    description: "Company-facing lifecycle projected from WorkItem, WorkCapsule, decisions, and verification state.",
    implementationStatus: "partially-implemented",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
  },
  {
    elementId: "ACT-WC-register-source",
    elementType: "action",
    name: "Register source",
    description: "Declare Work Case source metadata, default policy, and resolver behavior.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate"],
  },
  {
    elementId: "ACT-WC-project-status",
    elementType: "action",
    name: "Project status",
    description: "Map substrate status into an explainable Work Case state.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
  },
  {
    elementId: "ACT-WC-derive-summary",
    elementType: "action",
    name: "Derive summary",
    description: "Build a source-referenced Work Case summary/detail read model.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate"],
  },
  {
    elementId: "PART-WC-source-registry",
    elementType: "part_definition",
    name: "Work Case source registry",
    description: "Canonical registry for WorkItem source types and account-resolvable business source shapes.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate"],
  },
  {
    elementId: "PART-WC-case-projection",
    elementType: "part_definition",
    name: "Work Case projection",
    description: "Projection layer that turns existing substrate records into company-facing case summaries.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
  },
  {
    elementId: "IF-WC-agentcard",
    elementType: "interface_definition",
    name: "AgentCard-compatible capability descriptor",
    description: "Future capability descriptor for actor routing and A2A-aligned participation.",
    implementationStatus: "planned",
    itValueStreams: ["operate", "consume", "integrate"],
  },
  {
    elementId: "VC-WC-1",
    elementType: "verification_case",
    name: "Governed write path receipt guard",
    description: "Future guard proving consequential transitions cannot bypass governed Actions.",
    implementationStatus: "planned",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
  },
  {
    elementId: "VC-WC-2",
    elementType: "verification_case",
    name: "Receipt coverage and sealing verification",
    description: "Future guard proving receipts are emitted and terminal cases are sealed.",
    implementationStatus: "planned",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
  },
  {
    elementId: "VC-WC-3",
    elementType: "verification_case",
    name: "Accountable identity verification",
    description: "Future guard proving agent actors need sponsors before transitioning cases.",
    implementationStatus: "planned",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
  },
  {
    elementId: "VC-WC-4",
    elementType: "verification_case",
    name: "A2A lifecycle projection tests",
    description: "Wave 0 status projection tests for state and A2A lifecycle alignment.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
  },
  {
    elementId: "VC-WC-5",
    elementType: "verification_case",
    name: "Decision routing verification",
    description: "Future guard proving consequential decisions route through DecisionInteraction.",
    implementationStatus: "planned",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
  },
] as const satisfies readonly WorkCaseArchitectureElement[];

export const WORK_CASE_ARCHITECTURE_ALLOCATIONS = [
  {
    sourceElementId: "PART-WC-source-registry",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/source-registry.ts",
  },
  {
    sourceElementId: "SM-WC-LIFECYCLE",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/status-projection.ts",
  },
  {
    sourceElementId: "SM-WC-LIFECYCLE",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/case-types.ts",
  },
  {
    sourceElementId: "PART-WC-case-projection",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/case-read-model.ts",
  },
  {
    sourceElementId: "REQ-WC-4",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/architecture-grounding.ts",
  },
] as const satisfies readonly WorkCaseArchitectureAllocation[];

export function getWorkCaseRequirementVerificationPairs(): Array<{
  requirementId: string;
  verificationCaseId: string;
}> {
  return WORK_CASE_ARCHITECTURE_ELEMENTS
    .filter((element) => element.elementType === "requirement")
    .map((element) => ({
      requirementId: element.elementId,
      verificationCaseId: element.verificationCaseId ?? "",
    }));
}

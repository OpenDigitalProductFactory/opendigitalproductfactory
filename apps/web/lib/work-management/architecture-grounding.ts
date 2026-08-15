import { WORK_CASE_ACTION_REGISTRY } from "./action-registry";

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

const WORK_CASE_ACTION_ARCHITECTURE_ELEMENTS =
  WORK_CASE_ACTION_REGISTRY.map((action) => ({
    elementId: `ACT-WC-${action.action}`,
    elementType: "action",
    name: action.displayLabel,
    description: `Governed Work Case handoff action '${action.action}' backed by the action registry.`,
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
  })) satisfies readonly WorkCaseArchitectureElement[];

export const WORK_CASE_ARCHITECTURE_ELEMENTS = [
  {
    elementId: "REQ-WC-1",
    elementType: "requirement",
    name: "Governed write path",
    description: "Consequential Work Case transitions mutate only through governed Actions.",
    implementationStatus: "partially-implemented",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
    verificationCaseId: "VC-WC-1",
  },
  {
    elementId: "REQ-WC-2",
    elementType: "requirement",
    name: "Receipt coverage and sealing",
    description: "Every consequential transition emits a receipt and terminal cases are sealed.",
    implementationStatus: "partially-implemented",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
    verificationCaseId: "VC-WC-2",
  },
  {
    elementId: "REQ-WC-3",
    elementType: "requirement",
    name: "Accountable identity",
    description: "An agent actor without a named sponsor cannot transition a Work Case.",
    implementationStatus: "partially-implemented",
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
    elementId: "REQ-WC-6",
    elementType: "requirement",
    name: "Workspace operator surfaces",
    description: "Workspace exposes Work Cases as attention-first, evidence-first operator surfaces.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume"],
    verificationCaseId: "VC-WC-6",
  },
  {
    elementId: "REQ-WC-7",
    elementType: "requirement",
    name: "Capability advertisement and actor routing",
    description: "Work Case actors advertise AgentCard-compatible capabilities used for source/action routing.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate"],
    verificationCaseId: "VC-WC-7",
  },
  {
    elementId: "REQ-WC-8",
    elementType: "requirement",
    name: "Graduated autonomy envelope",
    description: "Work Case autonomy reads the existing trust dial per source, action, transition, and risk.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate"],
    verificationCaseId: "VC-WC-8",
  },
  {
    elementId: "REQ-WC-9",
    elementType: "requirement",
    name: "Federated actor governance",
    description: "External and federated agents participate only through authenticated, receipt-backed, control-tower-visible governance.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate"],
    verificationCaseId: "VC-WC-9",
  },
  {
    elementId: "REQ-WC-10",
    elementType: "requirement",
    name: "Customer-domain workflow adoption",
    description: "First customer-domain workflows adopt Work Case vocabulary without creating a parallel case engine.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume"],
    verificationCaseId: "VC-WC-10",
  },
  {
    elementId: "REQ-WC-11",
    elementType: "requirement",
    name: "Constrained customer case view",
    description: "Portal users see only account-scoped, customer-safe Work Case status and next-action language.",
    implementationStatus: "implemented",
    itValueStreams: ["consume"],
    verificationCaseId: "VC-WC-11",
  },
  {
    elementId: "REQ-WC-12",
    elementType: "requirement",
    name: "Mobile attention surface",
    description: "Workspace exposes a mobile-first Work Case attention surface backed by the same canonical projection.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume"],
    verificationCaseId: "VC-WC-12",
  },
  {
    elementId: "REQ-WC-13",
    elementType: "requirement",
    name: "Customer-safe portal case drill-down",
    description: "Portal customers can inspect a single account-scoped Work Case without seeing internal WorkItem or source references.",
    implementationStatus: "implemented",
    itValueStreams: ["consume"],
    verificationCaseId: "VC-WC-13",
  },
  {
    elementId: "SM-WC-LIFECYCLE",
    elementType: "state_machine",
    name: "Work Case lifecycle",
    description: "Company-facing lifecycle projected from WorkItem, Workroom, decisions, and verification state.",
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
  ...WORK_CASE_ACTION_ARCHITECTURE_ELEMENTS,
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
    elementId: "PART-WC-action-registry",
    elementType: "part_definition",
    name: "Work Case action registry",
    description: "Canonical handoff grammar and consequential-action metadata for governed transitions.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
  },
  {
    elementId: "PART-WC-policy-envelope",
    elementType: "part_definition",
    name: "Work Case policy envelope",
    description: "Pure policy evaluator for source support, terminal sealing, decisions, staging, and receipts.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
  },
  {
    elementId: "PART-WC-accountability",
    elementType: "part_definition",
    name: "Work Case accountability context",
    description: "Typed authority-mode and accountable-principal validation for actors that transition Work Cases.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
  },
  {
    elementId: "PART-WC-staged-transition",
    elementType: "state_machine",
    name: "Work Case staged transition",
    description: "Staged-before-commit transition projection for approve/edit/reject/respond workflows.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
  },
  {
    elementId: "PART-WC-stop-conditions",
    elementType: "part_definition",
    name: "Work Case stop conditions",
    description: "Deterministic stop-condition evaluation for iteration, budget, timebox, approval, receipt, policy, and terminal sealing.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
  },
  {
    elementId: "PART-WC-receipt-envelope",
    elementType: "part_definition",
    name: "Work Case receipt envelope",
    description: "Projection envelope that normalizes governed receipts and observed substrate events.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
  },
  {
    elementId: "PART-WC-case-telemetry",
    elementType: "part_definition",
    name: "Work Case telemetry projection",
    description: "OTel-compatible event projection for receipt-backed Work Case actions.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
  },
  {
    elementId: "PART-WC-workspace-loader",
    elementType: "part_definition",
    name: "Workspace Work Case loader",
    description: "Server-side read model that projects WorkItem rows into Workspace Work Case list and detail views.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume"],
  },
  {
    elementId: "PART-WC-attention-lens",
    elementType: "part_definition",
    name: "Workspace Work Case attention lens",
    description: "Theme-aware Workspace surface that orders Work Cases by human attention and next action.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume"],
  },
  {
    elementId: "PART-WC-case-detail-surface",
    elementType: "part_definition",
    name: "Work Case detail surface",
    description: "Evidence-first Workspace drill-down for a single projected Work Case.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume"],
  },
  {
    elementId: "IF-WC-agentcard",
    elementType: "interface_definition",
    name: "AgentCard-compatible capability descriptor",
    description: "Capability descriptor for actor routing and A2A-aligned participation.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate"],
  },
  {
    elementId: "PART-WC-agent-capability",
    elementType: "part_definition",
    name: "Work Case actor capability routing",
    description: "Pure AgentCard-compatible descriptor projection and actor ranking for Work Case routing.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate"],
  },
  {
    elementId: "PART-WC-autonomy-envelope",
    elementType: "part_definition",
    name: "Work Case autonomy envelope",
    description: "Pure resolver that maps trust-graduation state and risk ceilings into Work Case policy envelopes.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate"],
  },
  {
    elementId: "PART-WC-federation-governance",
    elementType: "part_definition",
    name: "Work Case federation governance",
    description: "Pure governance guard for external and federated actor participation in Work Cases.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate"],
  },
  {
    elementId: "PART-WC-customer-domain-adoption",
    elementType: "part_definition",
    name: "Customer-domain Work Case adoption",
    description: "Pure projection that groups customer Work Cases into domain workflow lanes with WWWD decision scope.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume"],
  },
  {
    elementId: "PART-WC-portal-case-view",
    elementType: "part_definition",
    name: "Portal Work Case view",
    description: "Account-scoped loader and customer-facing component for constrained Portal Work Case visibility.",
    implementationStatus: "implemented",
    itValueStreams: ["consume"],
  },
  {
    elementId: "PART-WC-portal-case-detail",
    elementType: "part_definition",
    name: "Portal Work Case detail",
    description: "Customer-safe Portal drill-down route and component for a single account-scoped Work Case.",
    implementationStatus: "implemented",
    itValueStreams: ["consume"],
  },
  {
    elementId: "PART-WC-mobile-attention",
    elementType: "part_definition",
    name: "Mobile Work Case attention strip",
    description: "Responsive mobile scan surface for attention-required Work Cases inside the Workspace lens.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume"],
  },
  {
    elementId: "VC-WC-1",
    elementType: "verification_case",
    name: "Governed write path receipt guard",
    description: "Tests proving optional Work Case context is policy-checked and can emit governed receipts.",
    implementationStatus: "partially-implemented",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
  },
  {
    elementId: "VC-WC-2",
    elementType: "verification_case",
    name: "Receipt coverage and sealing verification",
    description: "Pure guard tests proving consequential actions require governed receipts and terminal cases are sealed.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate", "deploy", "release"],
  },
  {
    elementId: "VC-WC-3",
    elementType: "verification_case",
    name: "Accountable identity verification",
    description: "Guard tests proving agent actors need sponsor or authenticated-inbound accountability before transitioning cases.",
    implementationStatus: "implemented",
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
  {
    elementId: "VC-WC-6",
    elementType: "verification_case",
    name: "Workspace Work Case UX verification",
    description: "Tests and UX checks proving Workspace Work Cases are attention-first, evidence-first, theme-aware, and correctly routed.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume"],
  },
  {
    elementId: "VC-WC-7",
    elementType: "verification_case",
    name: "Agent capability routing verification",
    description: "Pure tests proving AgentCard-compatible descriptors route by source, action, case type, and accountability.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate"],
  },
  {
    elementId: "VC-WC-8",
    elementType: "verification_case",
    name: "Autonomy envelope verification",
    description: "Pure tests proving Work Case autonomy is capped by risk and projected from the existing trust dial.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate"],
  },
  {
    elementId: "VC-WC-9",
    elementType: "verification_case",
    name: "Federated participation governance verification",
    description: "Pure tests proving federated actors require authenticated inbound identity, receipts, stop conditions, and control-tower visibility.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume", "integrate"],
  },
  {
    elementId: "VC-WC-10",
    elementType: "verification_case",
    name: "Customer-domain adoption verification",
    description: "Pure tests proving customer source Work Cases group into WWWD workflow lanes while excluding platform sources.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume"],
  },
  {
    elementId: "VC-WC-11",
    elementType: "verification_case",
    name: "Portal constrained case verification",
    description: "Loader and component tests proving Portal Work Cases are account-scoped and customer-safe.",
    implementationStatus: "implemented",
    itValueStreams: ["consume"],
  },
  {
    elementId: "VC-WC-12",
    elementType: "verification_case",
    name: "Mobile attention verification",
    description: "Component tests proving Workspace renders a mobile-first attention strip from the canonical Work Case projection.",
    implementationStatus: "implemented",
    itValueStreams: ["operate", "consume"],
  },
  {
    elementId: "VC-WC-13",
    elementType: "verification_case",
    name: "Portal case drill-down verification",
    description: "Loader, component, and route-grounding tests proving Portal case detail is account-scoped, customer-safe, and theme-aware.",
    implementationStatus: "implemented",
    itValueStreams: ["consume"],
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
    sourceElementId: "PART-WC-action-registry",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/action-registry.ts",
  },
  {
    sourceElementId: "PART-WC-policy-envelope",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/policy-envelope.ts",
  },
  {
    sourceElementId: "PART-WC-accountability",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/accountability.ts",
  },
  {
    sourceElementId: "PART-WC-staged-transition",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/staged-transition.ts",
  },
  {
    sourceElementId: "PART-WC-stop-conditions",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/stop-conditions.ts",
  },
  {
    sourceElementId: "PART-WC-receipt-envelope",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/receipt-envelope.ts",
  },
  {
    sourceElementId: "VC-WC-2",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/receipt-coverage.ts",
  },
  {
    sourceElementId: "PART-WC-case-telemetry",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/case-telemetry.ts",
  },
  {
    sourceElementId: "PART-WC-workspace-loader",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/workspace-case-loader.ts",
  },
  {
    sourceElementId: "PART-WC-attention-lens",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/components/workspace/WorkCaseAttentionLens.tsx",
  },
  {
    sourceElementId: "PART-WC-attention-lens",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/app/(shell)/workspace/my-queue/page.tsx",
  },
  {
    sourceElementId: "PART-WC-case-detail-surface",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/components/workspace/WorkCaseDetailView.tsx",
  },
  {
    sourceElementId: "PART-WC-case-detail-surface",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/app/(shell)/workspace/cases/[caseKey]/page.tsx",
  },
  {
    sourceElementId: "VC-WC-6",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/navigation/portal-navigation-model.ts",
  },
  {
    sourceElementId: "VC-WC-6",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/components/agent/AgentFAB.tsx",
  },
  {
    sourceElementId: "IF-WC-agentcard",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/agent-capability.ts",
  },
  {
    sourceElementId: "PART-WC-agent-capability",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/agent-capability.ts",
  },
  {
    sourceElementId: "PART-WC-autonomy-envelope",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/autonomy-envelope.ts",
  },
  {
    sourceElementId: "PART-WC-federation-governance",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/federation-governance.ts",
  },
  {
    sourceElementId: "PART-WC-customer-domain-adoption",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/customer-domain-adoption.ts",
  },
  {
    sourceElementId: "PART-WC-portal-case-view",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/portal-case-loader.ts",
  },
  {
    sourceElementId: "PART-WC-portal-case-view",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/components/portal/PortalWorkCases.tsx",
  },
  {
    sourceElementId: "PART-WC-portal-case-view",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/app/(portal)/portal/cases/page.tsx",
  },
  {
    sourceElementId: "PART-WC-portal-case-view",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/app/(portal)/portal/page.tsx",
  },
  {
    sourceElementId: "PART-WC-portal-case-detail",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/portal-case-loader.ts",
  },
  {
    sourceElementId: "PART-WC-portal-case-detail",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/components/portal/PortalWorkCaseDetail.tsx",
  },
  {
    sourceElementId: "PART-WC-portal-case-detail",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/app/(portal)/portal/cases/[caseKey]/page.tsx",
  },
  {
    sourceElementId: "PART-WC-mobile-attention",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/components/workspace/WorkCaseAttentionLens.tsx",
  },
  {
    sourceElementId: "VC-WC-1",
    relationshipType: "sysml_allocates",
    targetKind: "source_file",
    targetRef: "apps/web/lib/work-management/work-case-governance-hook.ts",
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

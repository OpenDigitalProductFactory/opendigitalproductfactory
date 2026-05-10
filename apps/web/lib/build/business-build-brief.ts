import type { FeatureBrief } from "@/lib/feature-build-types";

export type BusinessBuildBriefSource =
  | "user_conversation"
  | "artifact_reference"
  | "existing_example"
  | "coworker_proposal"
  | "innovation_radar";

export type CapabilityPack =
  | "Operations"
  | "Customer Support"
  | "Finance"
  | "Sales"
  | "Marketing"
  | "Design / UX"
  | "Platform Governance"
  | "Build Studio / Self-Development";

export type CapabilityPackId =
  | "operations"
  | "customer_support"
  | "finance"
  | "sales"
  | "marketing"
  | "design_ux"
  | "platform_governance"
  | "build_studio_self_development";

export type BusinessBriefConfidence = "high" | "medium" | "low";

export type BusinessBriefStatus =
  | "draft"
  | "gathering_evidence"
  | "redacting"
  | "interpreting"
  | "awaiting_clarification"
  | "accepted"
  | "converted_to_build"
  | "rejected"
  | "superseded";

export type BusinessBriefEvidenceKind =
  | "artifact"
  | "existing_example"
  | "conversation"
  | "coworker"
  | "market_signal";

export type BusinessBriefEvidence = {
  kind: BusinessBriefEvidenceKind;
  label: string;
  summary: string;
  url?: string;
};

export type BusinessBuildBrief = {
  title: string;
  intakeSource: BusinessBuildBriefSource;
  businessOutcome: string;
  affectedPeople: string[];
  affectedWorkflow: string | null;
  sourceEvidence: BusinessBriefEvidence[];
  successSignals: string[];
  constraints: string[];
  businessInterpretation: string;
  capabilityPackId: CapabilityPackId;
  capabilityPack: CapabilityPack;
  riskProfile: {
    customerFacing: boolean;
    complianceSensitive: boolean;
    revenueImpacting: boolean;
    operationalRisk: boolean;
    level: "low" | "medium" | "high";
  };
  technicalInterpretation: {
    dataNeeds: string | null;
    likelyWorkflowImpact: string[];
    verificationFocus: string[];
  };
  openQuestions: string[];
  confidence: BusinessBriefConfidence;
};

export type BuildBusinessBuildBriefInput = {
  source: BusinessBuildBriefSource;
  featureBrief: FeatureBrief;
  evidence?: BusinessBriefEvidence[];
  exampleToEmulate?: string;
  constraints?: string[];
};

export type BusinessBriefTransitionInput = {
  from: BusinessBriefStatus;
  to: BusinessBriefStatus;
  confidence?: BusinessBriefConfidence | null;
  openQuestions?: string[];
};

const CAPABILITY_PACKS: Array<{
  id: CapabilityPackId;
  label: CapabilityPack;
  keywords: string[];
}> = [
  {
    id: "customer_support",
    label: "Customer Support",
    keywords: ["support", "ticket", "escalation", "customer success", "case"],
  },
  {
    id: "finance",
    label: "Finance",
    keywords: ["finance", "invoice", "payment", "billing", "expense", "revenue"],
  },
  {
    id: "sales",
    label: "Sales",
    keywords: ["sales", "pipeline", "opportunity", "crm", "prospect", "deal"],
  },
  {
    id: "marketing",
    label: "Marketing",
    keywords: ["marketing", "campaign", "lead", "content", "audience"],
  },
  {
    id: "design_ux",
    label: "Design / UX",
    keywords: ["design", "prototype", "wireframe", "ux", "usability"],
  },
  {
    id: "platform_governance",
    label: "Platform Governance",
    keywords: ["governance", "permission", "audit", "compliance", "policy"],
  },
  {
    id: "operations",
    label: "Operations",
    keywords: ["operations", "employee", "handoff", "task", "workflow", "site"],
  },
];

function cleanList(values: string[] | null | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

export function getCapabilityPackForBrief(text: string): CapabilityPack {
  return CAPABILITY_PACKS.find((pack) => includesAny(text.toLowerCase(), pack.keywords))?.label
    ?? "Build Studio / Self-Development";
}

export function getCapabilityPackIdForBrief(text: string): CapabilityPackId {
  const lower = text.toLowerCase();
  for (const pack of CAPABILITY_PACKS) {
    if (includesAny(lower, pack.keywords)) return pack.id;
  }
  return "build_studio_self_development";
}

function evidenceFromInputs(inputs: string[]): BusinessBriefEvidence[] {
  if (inputs.length === 0) return [];
  return [{
    kind: "artifact",
    label: "Provided references",
    summary: inputs.join("; "),
  }];
}

function riskLevel(featureBrief: FeatureBrief, constraints: string[]): BusinessBuildBrief["riskProfile"] {
  const text = [
    featureBrief.title,
    featureBrief.description,
    featureBrief.portfolioContext,
    featureBrief.dataNeeds,
    ...constraints,
  ].join(" ").toLowerCase();

  const customerFacing = includesAny(text, ["customer", "tenant", "public", "support"]);
  const complianceSensitive = includesAny(text, ["compliance", "audit", "policy", "privacy", "regulated"]);
  const revenueImpacting = includesAny(text, ["invoice", "payment", "billing", "revenue", "sales"]);
  const operationalRisk = includesAny(text, ["workflow", "handoff", "escalation", "approval", "downtime"]);
  const riskCount = [customerFacing, complianceSensitive, revenueImpacting, operationalRisk].filter(Boolean).length;

  return {
    customerFacing,
    complianceSensitive,
    revenueImpacting,
    operationalRisk,
    level: riskCount >= 3 ? "high" : riskCount > 0 ? "medium" : "low",
  };
}

function openQuestionsFor(
  featureBrief: FeatureBrief,
  evidence: BusinessBriefEvidence[],
): string[] {
  const questions: string[] = [];
  if (cleanList(featureBrief.targetRoles).length === 0) {
    questions.push("Who is affected by this business change?");
  }
  if (evidence.length === 0) {
    questions.push("What evidence, example, or artifact should DPF use as the reference?");
  }
  if (cleanList(featureBrief.acceptanceCriteria).length === 0) {
    questions.push("What business signal proves this worked?");
  }
  return questions;
}

function confidenceFor(openQuestions: string[]): BusinessBriefConfidence {
  if (openQuestions.length === 0) return "high";
  if (openQuestions.length <= 3) return "medium";
  return "low";
}

const TERMINAL_BRIEF_STATUSES = new Set<BusinessBriefStatus>([
  "converted_to_build",
  "rejected",
  "superseded",
]);

const ALLOWED_BRIEF_TRANSITIONS: Record<BusinessBriefStatus, BusinessBriefStatus[]> = {
  draft: ["gathering_evidence", "rejected"],
  gathering_evidence: ["redacting", "interpreting", "rejected"],
  redacting: ["interpreting", "rejected"],
  interpreting: ["awaiting_clarification", "accepted", "rejected"],
  awaiting_clarification: ["interpreting", "rejected"],
  accepted: ["converted_to_build", "superseded"],
  converted_to_build: [],
  rejected: [],
  superseded: [],
};

export function canTransitionBusinessBriefStatus(input: BusinessBriefTransitionInput): boolean {
  if (input.from === input.to) return true;
  if (TERMINAL_BRIEF_STATUSES.has(input.from)) return false;
  if (!ALLOWED_BRIEF_TRANSITIONS[input.from].includes(input.to)) return false;

  if (input.from === "interpreting" && input.to === "accepted") {
    if (input.confidence === "low" || input.confidence == null) return false;
    if ((input.openQuestions ?? []).length > 0) return false;
  }

  return true;
}

export function buildBusinessBuildBrief(input: BuildBusinessBuildBriefInput): BusinessBuildBrief {
  const { featureBrief } = input;
  const inputEvidence = evidenceFromInputs(cleanList(featureBrief.inputs));
  const exampleEvidence: BusinessBriefEvidence[] = input.exampleToEmulate
    ? [{
      kind: "existing_example",
      label: input.exampleToEmulate,
      summary: "Example workflow or artifact to emulate or adapt.",
    }]
    : [];
  const sourceEvidence = [
    ...(input.evidence ?? []),
    ...inputEvidence,
    ...exampleEvidence,
  ];
  const constraints = cleanList(input.constraints);
  const affectedPeople = cleanList(featureBrief.targetRoles);
  const successSignals = cleanList(featureBrief.acceptanceCriteria);
  const capabilityText = [
    featureBrief.title,
    featureBrief.description,
    featureBrief.portfolioContext,
  ].join(" ");
  const capabilityPackId = getCapabilityPackIdForBrief(capabilityText);
  const capabilityPack = getCapabilityPackForBrief(capabilityText);
  const openQuestions = openQuestionsFor(featureBrief, sourceEvidence);

  return {
    title: featureBrief.title,
    intakeSource: input.source,
    businessOutcome: featureBrief.description,
    affectedPeople,
    affectedWorkflow: featureBrief.portfolioContext || null,
    sourceEvidence,
    successSignals,
    constraints,
    businessInterpretation: `${featureBrief.title}: ${featureBrief.description}`,
    capabilityPackId,
    capabilityPack,
    riskProfile: riskLevel(featureBrief, constraints),
    technicalInterpretation: {
      dataNeeds: featureBrief.dataNeeds || null,
      likelyWorkflowImpact: [
        featureBrief.portfolioContext,
        ...affectedPeople,
      ].filter(Boolean),
      verificationFocus: successSignals,
    },
    openQuestions,
    confidence: confidenceFor(openQuestions),
  };
}

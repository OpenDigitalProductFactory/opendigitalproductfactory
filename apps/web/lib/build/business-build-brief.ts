import type { FeatureBrief } from "@/lib/feature-build-types";
import type { Prisma } from "@dpf/db";

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
  | "document"
  | "screenshot"
  | "spreadsheet"
  | "url"
  | "existing_route"
  | "backlog_item"
  | "feature_build"
  | "email"
  | "existing_example"
  | "conversation"
  | "coworker"
  | "market_signal";

export type BusinessBriefEvidence = {
  kind: BusinessBriefEvidenceKind;
  label: string;
  summary: string;
  url?: string;
  copy?: string[];
  adapt?: string[];
  avoid?: string[];
};

export type BusinessBuildBrief = {
  briefId?: string;
  title: string;
  status?: BusinessBriefStatus;
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

export type LegacyFeatureBuildBriefBackfillInput = {
  orgId: string;
  buildId: string;
  featureBuildId?: string | null;
  title: string;
  brief: unknown;
  submittedByUserId?: string | null;
};

export type BusinessBuildBriefPersistenceInput = {
  briefId: string;
  orgId: string;
  status: BusinessBriefStatus;
  intakeSource: BusinessBuildBriefSource;
  capabilityPackId: CapabilityPackId;
  featureBuildId: string | null;
  backlogItemId: string | null;
  businessOutcome: string;
  affectedPeople: Array<{ kind: "persona"; label: string }>;
  affectedWorkflow: string | null;
  sourceEvidence: BusinessBriefEvidence[];
  successSignals: string[];
  constraints: string[];
  businessInterpretation: string;
  technicalInterpretation: BusinessBuildBrief["technicalInterpretation"];
  riskProfile: BusinessBuildBrief["riskProfile"];
  hiveReadiness: {
    disposition: "local_only" | "candidate" | "approved_for_hive" | "contributed";
    generalizationNotes?: string;
  };
  openQuestions: string[];
  confidence: BusinessBriefConfidence;
  confidenceRationale: string;
  submittedByUserId: string | null;
};

export type BusinessBuildBriefRecordInput = {
  briefId?: string;
  status?: BusinessBriefStatus;
  intakeSource: BusinessBuildBriefSource;
  capabilityPackId: string | null;
  businessOutcome: string;
  affectedPeople: unknown;
  affectedWorkflow: string | null;
  sourceEvidence: unknown;
  successSignals: string[];
  constraints: string[];
  businessInterpretation: string | null;
  technicalInterpretation: unknown;
  riskProfile: unknown;
  openQuestions: string[];
  confidence: BusinessBriefConfidence | null;
};

export const BUSINESS_BUILD_BRIEF_RECORD_SELECT = {
  briefId: true,
  status: true,
  intakeSource: true,
  capabilityPackId: true,
  businessOutcome: true,
  affectedPeople: true,
  affectedWorkflow: true,
  sourceEvidence: true,
  successSignals: true,
  constraints: true,
  businessInterpretation: true,
  technicalInterpretation: true,
  riskProfile: true,
  openQuestions: true,
  confidence: true,
} satisfies Prisma.BusinessBuildBriefSelect;

export type BusinessBuildBriefEditInput = {
  briefId: string;
  intakeSource?: BusinessBuildBriefSource;
  evidenceKind?: BusinessBriefEvidenceKind;
  businessOutcome: string;
  affectedPeopleText: string;
  affectedWorkflow?: string | null;
  sourceEvidenceText: string;
  copyAdaptAvoidText?: string;
  successSignalsText: string;
  constraintsText: string;
  openQuestionsText: string;
  accept?: boolean;
};

export type BusinessBuildBriefEditPersistence = {
  intakeSource: BusinessBuildBriefSource;
  status: BusinessBriefStatus;
  accepted: boolean;
  businessOutcome: string;
  affectedPeople: Array<{ kind: "persona"; label: string }>;
  affectedWorkflow: string | null;
  sourceEvidence: BusinessBriefEvidence[];
  successSignals: string[];
  constraints: string[];
  businessInterpretation: string;
  technicalInterpretation: BusinessBuildBrief["technicalInterpretation"];
  riskProfile: BusinessBuildBrief["riskProfile"];
  openQuestions: string[];
  confidence: BusinessBriefConfidence;
  confidenceRationale: string;
  legacyFeatureBrief: FeatureBrief;
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

function textLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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

function copyAdaptAvoidFromText(value: string | null | undefined): {
  copy: string[];
  adapt: string[];
  avoid: string[];
} {
  const buckets = { copy: [] as string[], adapt: [] as string[], avoid: [] as string[] };
  for (const line of textLines(value ?? "")) {
    const match = /^(copy|adapt|avoid)\s*:\s*(.+)$/i.exec(line);
    if (!match) continue;
    const bucket = match[1]!.toLowerCase() as "copy" | "adapt" | "avoid";
    buckets[bucket].push(match[2]!.trim());
  }
  return buckets;
}

function copyAdaptAvoidLines(value: {
  copy: string[];
  adapt: string[];
  avoid: string[];
}): string[] {
  return [
    ...value.copy.map((entry) => `Copy: ${entry}`),
    ...value.adapt.map((entry) => `Adapt: ${entry}`),
    ...value.avoid.map((entry) => `Avoid: ${entry}`),
  ];
}

function evidenceKindForEdit(kind: BusinessBriefEvidenceKind | undefined): BusinessBriefEvidenceKind {
  if (
    kind === "document" ||
    kind === "screenshot" ||
    kind === "spreadsheet" ||
    kind === "url" ||
    kind === "existing_route" ||
    kind === "backlog_item" ||
    kind === "feature_build" ||
    kind === "email" ||
    kind === "existing_example" ||
    kind === "market_signal"
  ) {
    return kind;
  }
  return "artifact";
}

function intakeSourceForEdit(
  intakeSource: BusinessBuildBriefSource | undefined,
  evidenceKind: BusinessBriefEvidenceKind,
): BusinessBuildBriefSource {
  if (
    intakeSource === "user_conversation" ||
    intakeSource === "artifact_reference" ||
    intakeSource === "existing_example" ||
    intakeSource === "coworker_proposal" ||
    intakeSource === "innovation_radar"
  ) {
    return intakeSource;
  }
  if (evidenceKind === "existing_example" || evidenceKind === "existing_route" || evidenceKind === "feature_build") {
    return "existing_example";
  }
  if (evidenceKind === "coworker") return "coworker_proposal";
  if (evidenceKind === "market_signal") return "innovation_radar";
  return "artifact_reference";
}

function evidenceFromText(
  value: string,
  kind: BusinessBriefEvidenceKind = "artifact",
  copyAdaptAvoid?: { copy: string[]; adapt: string[]; avoid: string[] },
): BusinessBriefEvidence[] {
  return textLines(value).map((line) => ({
    kind,
    label: line.length > 80 ? `${line.slice(0, 77)}...` : line,
    summary: line,
    ...(kind === "existing_example" && copyAdaptAvoid
      ? {
        copy: copyAdaptAvoid.copy,
        adapt: copyAdaptAvoid.adapt,
        avoid: copyAdaptAvoid.avoid,
      }
      : {}),
  }));
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

function confidenceForBusinessEdit(openQuestions: string[]): BusinessBriefConfidence {
  if (openQuestions.length === 0) return "high";
  if (openQuestions.length <= 3) return "medium";
  return "low";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.map((entry) => typeof entry === "string" ? entry.trim() : "").filter(Boolean);
}

function capabilityPackLabel(id: string | null | undefined): CapabilityPack {
  const normalizedId = capabilityPackIdFromRecord(id);
  return CAPABILITY_PACKS.find((pack) => pack.id === normalizedId)?.label
    ?? "Build Studio / Self-Development";
}

function capabilityPackIdFromRecord(id: string | null | undefined): CapabilityPackId {
  return CAPABILITY_PACKS.some((pack) => pack.id === id)
    ? id as CapabilityPackId
    : "build_studio_self_development";
}

function affectedPeopleFromRecord(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      if (!isRecord(entry)) return "";
      const label = stringField(entry, "label");
      if (label) return label;
      return stringField(entry, "principalId");
    })
    .filter(Boolean);
}

function evidenceFromRecord(value: unknown): BusinessBriefEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const label = stringField(entry, "label") || stringField(entry, "kind") || "Evidence";
    const summary = stringField(entry, "summary") || stringField(entry, "note") || label;
    const kind = stringField(entry, "kind");
    const href = stringField(entry, "href") || stringField(entry, "url");
    const copy = stringArrayField(entry, "copy");
    const adapt = stringArrayField(entry, "adapt");
    const avoid = stringArrayField(entry, "avoid");
    return [{
      kind: (
        kind === "document" ||
        kind === "screenshot" ||
        kind === "spreadsheet" ||
        kind === "url" ||
        kind === "existing_route" ||
        kind === "backlog_item" ||
        kind === "feature_build" ||
        kind === "email" ||
        kind === "existing_example" ||
        kind === "conversation" ||
        kind === "coworker" ||
        kind === "market_signal"
      ) ? kind : "artifact",
      label,
      summary,
      ...(href ? { url: href } : {}),
      ...(copy.length > 0 ? { copy } : {}),
      ...(adapt.length > 0 ? { adapt } : {}),
      ...(avoid.length > 0 ? { avoid } : {}),
    } satisfies BusinessBriefEvidence];
  });
}

function technicalInterpretationFromRecord(
  value: unknown,
): BusinessBuildBrief["technicalInterpretation"] {
  if (!isRecord(value)) {
    return { dataNeeds: null, likelyWorkflowImpact: [], verificationFocus: [] };
  }
  return {
    dataNeeds: stringField(value, "dataNeeds") || null,
    likelyWorkflowImpact: stringArrayField(value, "likelyWorkflowImpact"),
    verificationFocus: stringArrayField(value, "verificationFocus"),
  };
}

function riskProfileFromRecord(value: unknown): BusinessBuildBrief["riskProfile"] {
  if (!isRecord(value)) {
    return {
      customerFacing: false,
      complianceSensitive: false,
      revenueImpacting: false,
      operationalRisk: false,
      level: "low",
    };
  }
  const level = stringField(value, "level");
  return {
    customerFacing: value.customerFacing === true,
    complianceSensitive: value.complianceSensitive === true,
    revenueImpacting: value.revenueImpacting === true,
    operationalRisk: value.operationalRisk === true,
    level: level === "high" || level === "medium" ? level : "low",
  };
}

function coerceLegacyFeatureBrief(value: unknown, fallbackTitle: string): FeatureBrief {
  if (!isRecord(value)) {
    throw new Error("Legacy feature brief must be an object before it can be backfilled.");
  }

  const title = stringField(value, "title") || fallbackTitle.trim();
  const description = stringField(value, "description");
  if (!description) {
    throw new Error("Legacy feature brief is missing a business description.");
  }

  return {
    title,
    description,
    portfolioContext: stringField(value, "portfolioContext"),
    targetRoles: stringArrayField(value, "targetRoles"),
    inputs: stringArrayField(value, "inputs"),
    dataNeeds: stringField(value, "dataNeeds"),
    acceptanceCriteria: stringArrayField(value, "acceptanceCriteria"),
  };
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

export function businessBuildBriefFromRecord(input: {
  title: string;
  row: BusinessBuildBriefRecordInput;
}): BusinessBuildBrief {
  const capabilityPackId = capabilityPackIdFromRecord(input.row.capabilityPackId);
  const capabilityPack = capabilityPackLabel(input.row.capabilityPackId);
  return {
    ...(input.row.briefId ? { briefId: input.row.briefId } : {}),
    title: input.title,
    ...(input.row.status ? { status: input.row.status } : {}),
    intakeSource: input.row.intakeSource,
    businessOutcome: input.row.businessOutcome,
    affectedPeople: affectedPeopleFromRecord(input.row.affectedPeople),
    affectedWorkflow: input.row.affectedWorkflow,
    sourceEvidence: evidenceFromRecord(input.row.sourceEvidence),
    successSignals: input.row.successSignals,
    constraints: input.row.constraints,
    businessInterpretation: input.row.businessInterpretation ?? input.row.businessOutcome,
    capabilityPackId,
    capabilityPack,
    riskProfile: riskProfileFromRecord(input.row.riskProfile),
    technicalInterpretation: technicalInterpretationFromRecord(input.row.technicalInterpretation),
    openQuestions: input.row.openQuestions,
    confidence: input.row.confidence ?? "low",
  };
}

export function businessBuildBriefEditToPersistence(
  input: BusinessBuildBriefEditInput,
): BusinessBuildBriefEditPersistence {
  const briefId = input.briefId.trim();
  if (!briefId) throw new Error("Brief id is required");

  const businessOutcome = input.businessOutcome.trim();
  if (!businessOutcome) throw new Error("Business outcome is required");

  const evidenceKind = evidenceKindForEdit(input.evidenceKind);
  const intakeSource = intakeSourceForEdit(input.intakeSource, evidenceKind);
  const copyAdaptAvoid = copyAdaptAvoidFromText(input.copyAdaptAvoidText);
  const copyAdaptAvoidEvidence = copyAdaptAvoidLines(copyAdaptAvoid);
  const affectedPeople = textLines(input.affectedPeopleText);
  const sourceEvidence = evidenceFromText(input.sourceEvidenceText, evidenceKind, copyAdaptAvoid);
  const successSignals = textLines(input.successSignalsText);
  const constraints = textLines(input.constraintsText);
  const openQuestions = textLines(input.openQuestionsText);

  if (affectedPeople.length === 0) openQuestions.push("Who is affected by this business change?");
  if (sourceEvidence.length === 0) {
    openQuestions.push("What evidence, example, or artifact should DPF use as the reference?");
  }
  if (successSignals.length === 0) openQuestions.push("What business signal proves this worked?");

  const confidence = confidenceForBusinessEdit(openQuestions);
  const accepted = input.accept === true && confidence !== "low" && openQuestions.length === 0;
  const affectedWorkflow = input.affectedWorkflow?.trim() || null;
  const likelyWorkflowImpact = [
    affectedWorkflow,
    ...affectedPeople,
  ].filter((value): value is string => Boolean(value));
  const technicalInterpretation = {
    dataNeeds: null,
    likelyWorkflowImpact,
    verificationFocus: successSignals,
  };
  const riskProfile: BusinessBuildBrief["riskProfile"] = {
    customerFacing: false,
    complianceSensitive: constraints.some((constraint) => /audit|compliance|privacy|regulated/i.test(constraint)),
    revenueImpacting: constraints.some((constraint) => /revenue|billing|payment|invoice/i.test(constraint)),
    operationalRisk: true,
    level: constraints.length > 0 ? "medium" : "low",
  };

  return {
    intakeSource,
    status: accepted ? "accepted" : "awaiting_clarification",
    accepted,
    businessOutcome,
    affectedPeople: affectedPeople.map((label) => ({ kind: "persona", label })),
    affectedWorkflow,
    sourceEvidence,
    successSignals,
    constraints,
    businessInterpretation: copyAdaptAvoidEvidence.length > 0
      ? `${businessOutcome}\n\n${copyAdaptAvoidEvidence.join("\n")}`
      : businessOutcome,
    technicalInterpretation,
    riskProfile,
    openQuestions,
    confidence,
    confidenceRationale: openQuestions.length === 0
      ? "The brief has a business outcome, affected people, evidence, and success signals."
      : `The brief still needs clarification: ${openQuestions.join(" ")}`,
    legacyFeatureBrief: {
      title: briefId,
      description: businessOutcome,
      portfolioContext: affectedWorkflow ?? "",
      targetRoles: affectedPeople,
      inputs: [
        ...sourceEvidence.map((evidence) => evidence.summary),
        ...copyAdaptAvoidEvidence,
      ],
      dataNeeds: technicalInterpretation.dataNeeds ?? "",
      acceptanceCriteria: successSignals,
    },
  };
}

export function legacyFeatureBuildBriefToBusinessBuildBriefInput(
  input: LegacyFeatureBuildBriefBackfillInput,
): BusinessBuildBriefPersistenceInput {
  const featureBrief = coerceLegacyFeatureBrief(input.brief, input.title);
  const brief = buildBusinessBuildBrief({
    source: "user_conversation",
    featureBrief,
  });
  const status: BusinessBriefStatus = canTransitionBusinessBriefStatus({
    from: "interpreting",
    to: "accepted",
    confidence: brief.confidence,
    openQuestions: brief.openQuestions,
  })
    ? "accepted"
    : "awaiting_clarification";

  return {
    briefId: `BBB-${input.buildId}`,
    orgId: input.orgId,
    status,
    intakeSource: "user_conversation",
    capabilityPackId: brief.capabilityPackId,
    featureBuildId: input.featureBuildId ?? null,
    backlogItemId: null,
    businessOutcome: brief.businessOutcome,
    affectedPeople: brief.affectedPeople.map((label) => ({ kind: "persona", label })),
    affectedWorkflow: brief.affectedWorkflow,
    sourceEvidence: brief.sourceEvidence,
    successSignals: brief.successSignals,
    constraints: brief.constraints,
    businessInterpretation: brief.businessInterpretation,
    technicalInterpretation: brief.technicalInterpretation,
    riskProfile: brief.riskProfile,
    hiveReadiness: {
      disposition: "local_only",
      generalizationNotes: "Backfilled from legacy FeatureBuild.brief JSON.",
    },
    openQuestions: brief.openQuestions,
    confidence: brief.confidence,
    confidenceRationale: brief.openQuestions.length === 0
      ? "Legacy FeatureBuild brief contained enough business outcome, affected people, evidence, and success signals."
      : `Backfill needs clarification: ${brief.openQuestions.join(" ")}`,
    submittedByUserId: input.submittedByUserId ?? null,
  };
}

export const COWORKER_PROCESS_REFINEMENT_STAGES = ["emergent", "repeatable", "codified"] as const;
export type CoworkerProcessRefinementStage = (typeof COWORKER_PROCESS_REFINEMENT_STAGES)[number];

export type CoworkerProcessRefinementEngagement = {
  engagementId: string;
  offerId: string;
  serviceId: string;
  providerAgentId: string;
  requestedOutcome: string;
  status: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type CoworkerRefinementSummary = {
  totalEngagements: number;
  emergent: number;
  repeatable: number;
  codified: number;
  approvalRequired: number;
  completed: number;
};

export type CoworkerAggregateOfferCandidate = {
  patternKey: string;
  offerId: string;
  serviceId: string;
  providerAgentId: string;
  representativeOutcome: string;
  engagementCount: number;
  recommendedStage: CoworkerProcessRefinementStage;
  engagementIds: string[];
  dmaic: {
    define: string;
    measure: {
      total: number;
      completed: number;
      approvalRequired: number;
      averageCycleHours: number | null;
    };
    analyze: {
      bottlenecks: string[];
    };
    improve: string[];
    control: string[];
  };
};

export type CoworkerEngagementRefinementAnalysis = {
  summary: CoworkerRefinementSummary;
  aggregateOfferCandidates: CoworkerAggregateOfferCandidate[];
};

export function classifyCoworkerEngagementProcessStage(
  engagement: Pick<CoworkerProcessRefinementEngagement, "metadata">,
  options: { repeatedPatternCount?: number; codifiedThreshold?: number } = {},
): CoworkerProcessRefinementStage {
  const processRefinement = record(record(engagement.metadata).processRefinement);
  const explicitStage = stringValue(processRefinement.stage);
  if (isProcessStage(explicitStage)) return explicitStage;

  const repeatedPatternCount = options.repeatedPatternCount ?? 1;
  const codifiedThreshold = options.codifiedThreshold ?? 5;
  if (repeatedPatternCount >= codifiedThreshold) return "codified";
  if (repeatedPatternCount >= 2) return "repeatable";
  return "emergent";
}

export function analyzeCoworkerEngagementRefinement(
  engagements: CoworkerProcessRefinementEngagement[],
  options: { repeatableThreshold?: number; codifiedThreshold?: number } = {},
): CoworkerEngagementRefinementAnalysis {
  const repeatableThreshold = options.repeatableThreshold ?? 3;
  const codifiedThreshold = options.codifiedThreshold ?? 5;
  const groups = new Map<string, CoworkerProcessRefinementEngagement[]>();

  for (const engagement of engagements) {
    const key = processPatternKey(engagement);
    groups.set(key, [...(groups.get(key) ?? []), engagement]);
  }

  const summary: CoworkerRefinementSummary = {
    totalEngagements: engagements.length,
    emergent: 0,
    repeatable: 0,
    codified: 0,
    approvalRequired: engagements.filter((engagement) => engagement.status === "needs-approval").length,
    completed: engagements.filter((engagement) => engagement.status === "completed").length,
  };

  for (const engagement of engagements) {
    const stage = classifyCoworkerEngagementProcessStage(engagement, {
      repeatedPatternCount: groups.get(processPatternKey(engagement))?.length ?? 1,
      codifiedThreshold,
    });
    summary[stage] += 1;
  }

  const aggregateOfferCandidates = Array.from(groups.entries())
    .filter(([, group]) => group.length >= repeatableThreshold)
    .map(([patternKey, group]) => buildAggregateOfferCandidate(patternKey, group, codifiedThreshold))
    .sort((a, b) => b.engagementCount - a.engagementCount || a.patternKey.localeCompare(b.patternKey));

  return { summary, aggregateOfferCandidates };
}

function buildAggregateOfferCandidate(
  patternKey: string,
  group: CoworkerProcessRefinementEngagement[],
  codifiedThreshold: number,
): CoworkerAggregateOfferCandidate {
  const representative = group[0];
  const completed = group.filter((engagement) => engagement.status === "completed");
  const approvalRequired = group.filter((engagement) => engagement.status === "needs-approval");
  const averageCycleHours = average(
    completed.flatMap((engagement) =>
      engagement.completedAt ? [(engagement.completedAt.getTime() - engagement.createdAt.getTime()) / 36e5] : [],
    ),
  );
  const recommendedStage = classifyCoworkerEngagementProcessStage(representative, {
    repeatedPatternCount: group.length,
    codifiedThreshold,
  });

  return {
    patternKey,
    offerId: representative.offerId,
    serviceId: representative.serviceId,
    providerAgentId: representative.providerAgentId,
    representativeOutcome: representative.requestedOutcome,
    engagementCount: group.length,
    recommendedStage,
    engagementIds: group.map((engagement) => engagement.engagementId),
    dmaic: {
      define: representative.requestedOutcome,
      measure: {
        total: group.length,
        completed: completed.length,
        approvalRequired: approvalRequired.length,
        averageCycleHours,
      },
      analyze: {
        bottlenecks: buildBottlenecks(group),
      },
      improve: buildImprovements(recommendedStage),
      control: [
        "Track cycle time, approval rate, completion rate, and rework for this pattern.",
        "Review the aggregate offer or playbook after material volume, cost, risk, or provider changes.",
      ],
    },
  };
}

function buildBottlenecks(group: CoworkerProcessRefinementEngagement[]): string[] {
  const bottlenecks: string[] = [];
  if (group.some((engagement) => engagement.status === "needs-approval")) bottlenecks.push("approval-required");
  if (group.some((engagement) => engagement.status === "rejected")) bottlenecks.push("request-rejected");
  if (group.some((engagement) => engagement.status === "cancelled")) bottlenecks.push("request-cancelled");
  return bottlenecks.length > 0 ? bottlenecks : ["none-detected"];
}

function buildImprovements(stage: CoworkerProcessRefinementStage): string[] {
  if (stage === "codified") {
    return [
      "Keep the aggregate offer or playbook owner accountable for routing rules, approval rails, and cost controls.",
      "Tune inputs, outputs, provider boundaries, and verification evidence from observed performance.",
    ];
  }
  if (stage === "repeatable") {
    return [
      "Promote this repeated request into an aggregate offer or playbook.",
      "Define owner, required inputs, outputs, approval rails, provider boundaries, and success metrics.",
    ];
  }
  return ["Capture routing rationale and observe recurrence before codifying the process."];
}

function processPatternKey(engagement: CoworkerProcessRefinementEngagement): string {
  return `${engagement.offerId}::${normalizeOutcome(engagement.requestedOutcome)}`;
}

function normalizeOutcome(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isProcessStage(value: string | null): value is CoworkerProcessRefinementStage {
  return Boolean(value && COWORKER_PROCESS_REFINEMENT_STAGES.includes(value as CoworkerProcessRefinementStage));
}

import type { AuditClass } from "@/lib/audit-classes";
import type { EnableCandidate } from "@/lib/inference/phase-enable-candidates";
import type {
  ActivityClass,
  ActivityDistributionShape,
  ActivityParentRef,
  ActivityRiskClass,
} from "@/lib/routing/activity-contract";

export type OperationsMapSeverity = "normal" | "attention" | "warning" | "critical";

export type OperationsMapStation = {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
};

export type OperationsMapLine = {
  id: string;
  label: string;
  stationIds: string[];
};

export type OperationsMapTemplate = {
  id: string;
  label: string;
  archetypeCategoryIds: string[];
  activationProfileTypes?: string[];
  stations: OperationsMapStation[];
  lines: OperationsMapLine[];
};

export type OperationsMapAgent = {
  id: string;
  agentId: string;
  slugId: string | null;
  name: string;
  tier: number;
  type: string;
  description: string | null;
  status: string;
  valueStream: string | null;
  it4itSections: string[];
  sensitivity: string;
  lifecycleStage: string;
  counts: {
    skills: number;
    toolGrants: number;
  };
};

export type StationedOperationsMapAgent = OperationsMapAgent & {
  stationId: string;
  stationLabel: string;
};

export type OperationsMapToolExecution = {
  id: string;
  threadId: string;
  agentId: string;
  userId: string;
  toolName: string;
  success: boolean;
  executionMode: string;
  routeContext: string | null;
  durationMs: number | null;
  createdAt: Date;
  auditClass: AuditClass | null;
  capabilityId: string | null;
  summary: string | null;
};

export type OperationsMapToolExecutionReceipt = {
  id: string;
  toolExecutionId: string;
  buildId: string | null;
  receiptKind: string;
  receiptStatus: string;
  executionStatus: string;
  expiresAt: Date;
  createdAt: Date;
  toolExecution: OperationsMapToolExecution | null;
};

export type OperationsMapBacklogEvidence = {
  id: string;
  backlogItemId: string;
  backlogItem?: {
    itemId: string;
  } | null;
  kind: string;
  summary: string;
  payload: unknown;
  recordedAt: Date;
  recordedById: string | null;
  recordedByAgentId: string | null;
  toolExecutionId: string | null;
};

export type OperationsMapExternalEvidence = {
  id: string;
  actorUserId: string;
  routeContext: string;
  operationType: string;
  target: string;
  provider: string;
  resultSummary: string;
  createdAt: Date;
};

export type OperationsMapTaskRun = {
  id: string;
  taskRunId: string;
  status: string;
  source: string;
  currentAgentId: string | null;
  routeContext: string | null;
  title: string;
  startedAt: Date;
  completedAt: Date | null;
};

export type OperationsMapProjectionSource =
  | "task-run"
  | "tool-execution"
  | "tool-receipt"
  | "evidence-backlog"
  | "evidence-external";

export type OperationsMapProjection = {
  id: string;
  occurredAt: string;
  actorAgentId: string | null;
  source: OperationsMapProjectionSource;
  location: {
    lineId: string;
    stationId: string;
  };
  severity: OperationsMapSeverity;
  summary: string;
  label: string;
  refs: {
    threadId?: string | null;
    toolExecutionId?: string | null;
    toolReceiptId?: string | null;
    backlogItemActivityId?: string | null;
    backlogItemId?: string | null;
    externalEvidenceRecordId?: string | null;
    taskRunId?: string | null;
    buildId?: string | null;
    capabilityId?: string | null;
  };
  links: {
    authorityHref?: string;
    coworkerHref?: string;
    historyHref?: string;
    backlogHref?: string;
  };
};

export type OperationsMapProjectionFilters = {
  sources: OperationsMapProjectionSource[];
  severities: OperationsMapSeverity[];
};

export type OperationsMapRoutingRouteState = "active" | "secondary" | "failover" | "scheduled" | "historical";

export type OperationsMapRoutingMarkerType = "decision" | "quota" | "error" | "failover" | "scheduled" | "governance";

export type OperationsMapRoutingProviderKind = "cloud" | "local" | "cli";

export type OperationsMapRoutingProviderType = "llm" | "mcp" | "other";

export type OperationsMapRoutingCoworker = {
  agentId: string;
  label: string;
  stationLabel: string | null;
};

export type OperationsMapRoutingProvider = {
  providerId: string;
  label: string;
  status: string;
  kind: OperationsMapRoutingProviderKind;
  providerType: OperationsMapRoutingProviderType;
  costUsd: number;
  tokenTotal: number;
  decisionCount: number;
};

export type OperationsMapRoutingRoute = {
  id: string;
  coworkerId: string;
  providerId: string;
  state: OperationsMapRoutingRouteState;
  label: string;
  summary: string;
  occurredAt: string | null;
  decisionId: string | null;
  trafficWeight: number;
  markerIds: string[];
};

export type OperationsMapRoutingMarker = {
  id: string;
  type: OperationsMapRoutingMarkerType;
  label: string;
  summary: string;
  routeId: string | null;
  coworkerId: string | null;
  actorKind?: string | null;
  actorId?: string | null;
  providerId: string | null;
  occurredAt: string | null;
};

export type OperationsMapRoutingTimelineMarker = {
  id: string;
  lane: "history" | "current" | "future";
  label: string;
  occurredAt: string;
  markerType: OperationsMapRoutingMarkerType;
};

export type OperationsMapRoutingLegendItem = {
  state: OperationsMapRoutingRouteState;
  label: string;
  description: string;
};

// ─── Typed-node / typed-edge graph (A2A re-architecture) ───────────────
//
// The topology was originally a two-lane bipartite graph: every edge ran
// coworker → provider. To surface coworker-to-coworker (A2A) interactions
// — delegation, build phase-handoff, task spawn/lineage, deliberation
// fan-out — the model is generalized so an edge declares its kind. Provider
// routes remain `OperationsMapRoutingRoute` (the `provider-route` variant);
// A2A interactions are `OperationsMapA2aEdge` and connect two coworkers.
// See docs/superpowers/specs/2026-06-04-ai-operations-map-a2a-interaction-visibility-design.md

export type OperationsMapNodeKind = "coworker" | "provider";

export type OperationsMapEdgeKind =
  | "provider-route"
  | "a2a-delegation"
  | "a2a-handoff"
  | "a2a-task-lineage"
  | "a2a-deliberation";

export type OperationsMapA2aEdgeKind = Exclude<OperationsMapEdgeKind, "provider-route">;

export type OperationsMapA2aInteractionState = "active" | "completed" | "failed" | "blocked";

export type OperationsMapA2aEdge = {
  id: string;
  edgeKind: OperationsMapA2aEdgeKind;
  fromCoworkerId: string;
  toCoworkerId: string;
  state: OperationsMapA2aInteractionState;
  label: string;
  summary: string;
  occurredAt: string | null;
  // Audit / troubleshooting envelope — populated where the source row carries it.
  authorityScope?: string[];
  sensitivity?: string | null;
  skillId?: string | null;
  buildId?: string | null;
  gateResult?: string | null;
  // Source-record references for click-through audit.
  refs: {
    delegationChainId?: string | null;
    phaseHandoffId?: string | null;
    taskRunId?: string | null;
    parentTaskRunId?: string | null;
    deliberationRunId?: string | null;
  };
  weight: number;
};

export type OperationsMapA2aLegendItem = {
  edgeKind: OperationsMapA2aEdgeKind;
  label: string;
  description: string;
};

// ─── Deliberation lens (Option B — coordinator-internal fan, no fabricated
// coworker identity) ────────────────────────────────────────────────────
//
// A deliberation is a coordinator coworker fanning a decision out to N branch
// review personas. Today those branches are NOT distinct registered coworkers
// (see docs/superpowers/specs/2026-06-05-deliberation-branch-identity-for-a2a-ops-map-design.md),
// so they are rendered as a coordinator-side lens — role + (where the run is
// diverse) model/provider pulled from TaskNode.routeDecision — rather than as
// coworker↔coworker A2A edges.

export type OperationsMapDeliberationBranch = {
  nodeId: string;
  role: string | null;
  modelId: string | null;
  providerId: string | null;
  status: string | null;
};

export type OperationsMapDeliberation = {
  id: string;
  coordinatorCoworkerId: string | null;
  coordinatorLabel: string;
  pattern: string | null;
  diversityMode: string;
  consensusState: string;
  occurredAt: string | null;
  branches: OperationsMapDeliberationBranch[];
};

export type OperationsMapRoutingTopology = {
  coworkers: OperationsMapRoutingCoworker[];
  providers: OperationsMapRoutingProvider[];
  routes: OperationsMapRoutingRoute[];
  activityRouting: OperationsMapActivityRouting | null;
  a2aEdges: OperationsMapA2aEdge[];
  deliberations: OperationsMapDeliberation[];
  markers: OperationsMapRoutingMarker[];
  timeline: OperationsMapRoutingTimelineMarker[];
  legend: OperationsMapRoutingLegendItem[];
  a2aLegend: OperationsMapA2aLegendItem[];
};

export type OperationsMapActivitySuccessSignal =
  | "unknown"
  | "valid"
  | "accepted"
  | "review-passed"
  | "failed"
  | "retried"
  | "attention";

export type OperationsMapActivityRoutingExclusion = {
  providerId: string;
  modelId: string | null;
  reason: string;
  code?: string;
  remediation?: string;
};

export type OperationsMapActivityStep = {
  activityId: string;
  label: string;
  activityClass: ActivityClass;
  distributionShape: ActivityDistributionShape;
  riskClass: ActivityRiskClass;
  selectedProviderId: string | null;
  selectedModelId: string | null;
  harnessRecipeKey: string | null;
  confidence: "provisional" | "calibrating" | "trusted" | "degraded" | null;
  successSignal: OperationsMapActivitySuccessSignal;
  costUsd: number | null;
  tokenTotal: number | null;
  routeDecisionId: string | null;
  adapterTelemetryId: string | null;
  decisionSummary: string;
  tuningRecommendation?: "observe" | "keep" | "promote" | "degrade" | null;
  tuningRationale?: string | null;
  actionProposalId?: string | null;
  actionProposalAction?: "promote" | "degrade" | null;
  actionProposalRecommendedConfidence?: "provisional" | "calibrating" | "trusted" | "degraded" | null;
  actionProposalSummary?: string | null;
  approvedConfidenceOverrideId?: string | null;
  exclusions: OperationsMapActivityRoutingExclusion[];
  enableCandidates?: EnableCandidate[];
};

export type OperationsMapActivityRouting = {
  taskRef: ActivityParentRef;
  activities: OperationsMapActivityStep[];
  generatedAt: string;
};

export type OperationsMapActivityOutcomeEvidenceStrength =
  | "route-only"
  | "linked";

export type OperationsMapActivityOutcome = {
  id: string;
  routeDecisionId: string;
  activityClass: ActivityClass;
  harnessRecipeKey: string;
  confidence: "provisional" | "calibrating" | "trusted" | "degraded";
  providerId: string;
  modelId: string | null;
  taskType: string;
  tokenTotal: number | null;
  costUsd: number | null;
  successSignal: OperationsMapActivitySuccessSignal;
  qualitySignal: number | null;
  evaluatorSource: string | null;
  evidenceStrength: OperationsMapActivityOutcomeEvidenceStrength;
  occurredAt: string;
};

export type OperationsMapQuickViewId = "all" | "exceptions" | "evidence" | "tool-runs";

export type OperationsMapQuickView = {
  id: OperationsMapQuickViewId;
  label: string;
  description: string;
  filters: OperationsMapProjectionFilters;
};

export type OperationsMapTemplateSelector = {
  archetypeId?: string | null;
  activationProfileType?: string | null;
};

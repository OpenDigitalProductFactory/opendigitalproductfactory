import type { AuditClass } from "@/lib/audit-classes";

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

// EP-A2A Slice 2 — coworker-to-coworker collaboration transfer (handoff/
// escalation), projected from DelegationChain hops. The operator-facing view of
// "which coworker handed off to which, and what happened."
export type OperationsMapCollaborationTransferState =
  | "active"
  | "completed"
  | "failed"
  | "blocked";

export type OperationsMapCollaborationTransfer = {
  id: string;
  fromAgentId: string;
  fromLabel: string;
  toAgentId: string;
  toLabel: string;
  state: OperationsMapCollaborationTransferState;
  occurredAt: string | null; // ISO
  reason: string | null;
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

export type OperationsMapRoutingTopology = {
  coworkers: OperationsMapRoutingCoworker[];
  providers: OperationsMapRoutingProvider[];
  routes: OperationsMapRoutingRoute[];
  markers: OperationsMapRoutingMarker[];
  timeline: OperationsMapRoutingTimelineMarker[];
  legend: OperationsMapRoutingLegendItem[];
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

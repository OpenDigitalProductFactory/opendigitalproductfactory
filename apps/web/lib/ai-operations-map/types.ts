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

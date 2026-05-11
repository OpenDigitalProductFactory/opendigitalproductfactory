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

export type OperationsMapProjection = {
  id: string;
  occurredAt: string;
  actorAgentId: string;
  source: "tool-execution";
  location: {
    lineId: string;
    stationId: string;
  };
  severity: OperationsMapSeverity;
  summary: string;
  label: string;
  refs: {
    threadId: string;
    toolExecutionId: string;
    capabilityId: string | null;
  };
  links: {
    authorityHref: string;
    coworkerHref: string;
  };
};

export type OperationsMapTemplateSelector = {
  archetypeId?: string | null;
  activationProfileType?: string | null;
};

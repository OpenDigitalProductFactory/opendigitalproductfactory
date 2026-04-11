import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "dpf-platform" });

// Event payload types for type-safe event sending
export interface CwqItemCreatedEvent {
  name: "cwq/item.created";
  data: { workItemId: string; sourceType: string; urgency: string };
}

export interface CwqItemCompletedEvent {
  name: "cwq/item.completed";
  data: {
    workItemId: string;
    outcome: "success" | "failed" | "cancelled";
    evidence?: unknown;
  };
}

export interface CwqItemCancelledEvent {
  name: "cwq/item.cancelled";
  data: { workItemId: string; reason: string };
}

export interface CwqApprovalRequestedEvent {
  name: "cwq/approval.requested";
  data: {
    workItemId: string;
    escalationTimeoutMinutes: number;
    escalationLevel?: number;
  };
}

export interface CwqApprovalResponseEvent {
  name: "cwq/approval.response";
  data: {
    workItemId: string;
    decision: "approve" | "reject" | "delegate";
    decidedBy: string;
  };
}

export interface OpsRateRecoverEvent {
  name: "ops/rate.recover";
  data: { providerId: string; modelId: string };
}

export interface OpsMcpCatalogSyncEvent {
  name: "ops/mcp-catalog.sync";
  data: { syncId: string };
}

export interface QualityIssueTriageEvent {
  name: "quality/issue-triage.run";
  data: Record<string, never>;
}

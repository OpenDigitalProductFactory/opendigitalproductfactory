import { prisma } from "@dpf/db";

import {
  createCoworkerEngagement,
  type CreateCoworkerEngagementInput,
} from "./engagements";

type JsonRecord = Record<string, unknown>;

type A2aTaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "auth-required"
  | "completed"
  | "failed"
  | "canceled"
  | "rejected";

export type CoworkerA2aTask = {
  id: string;
  contextId: string;
  status: {
    state: A2aTaskState;
    timestamp: string;
    reason?: string;
  };
  providerAgentId: string;
  offerId: string;
  serviceId: string;
  messages: Array<{
    role: "user" | "agent";
    parts: Array<{ kind: "text" | "data"; text?: string; data?: unknown }>;
  }>;
  artifacts: Array<{
    artifactId: string;
    name: string;
    parts: Array<{ kind: "data"; data: unknown }>;
  }>;
  metadata: {
    actingAgentGaid: string | null;
    delegatingAgentGaid: string | null;
    delegatedAgentId: string;
    approvalContext: unknown;
  };
};

export type CoworkerA2aTaskInput = {
  offerId: string;
  requestedOutcome: string;
  inputPayload?: unknown;
  fundingContext?: unknown;
  contractContext?: CreateCoworkerEngagementInput["contractContext"];
  contextId?: string;
  actingAgentGaid?: string | null;
  delegatingAgentGaid?: string | null;
  routingRationale?: {
    selectedOfferReason?: string;
    alternativesConsidered?: string[];
    processStage?: "emergent" | "repeatable" | "codified";
    aggregateOfferKey?: string | null;
  };
};

type EngagementRow = {
  engagementId: string;
  offerId: string;
  serviceId: string;
  providerAgentId: string;
  requestedOutcome: string;
  status: string;
  inputPayload: unknown;
  approvalContext: unknown;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

type DbClient = {
  coworkerEngagement: {
    findUnique(args: unknown): Promise<EngagementRow | null>;
  };
};

export async function createCoworkerA2aTask(
  input: CoworkerA2aTaskInput,
  deps: { createEngagement?: typeof createCoworkerEngagement } = {},
): Promise<CoworkerA2aTask> {
  const contextId = input.contextId ?? buildA2aContextId();
  const createEngagement = deps.createEngagement ?? createCoworkerEngagement;
  const metadata = {
    a2a: {
      contextId,
      actingAgentGaid: input.actingAgentGaid ?? null,
      delegatingAgentGaid: input.delegatingAgentGaid ?? null,
    },
    routingRationale: {
      selectedOfferReason: input.routingRationale?.selectedOfferReason ?? "A2A caller selected this coworker offer.",
      alternativesConsidered: input.routingRationale?.alternativesConsidered ?? [],
    },
    processRefinement: {
      stage: input.routingRationale?.processStage ?? "emergent",
      aggregateOfferKey: input.routingRationale?.aggregateOfferKey ?? null,
    },
  };
  const result = await createEngagement({
    offerId: input.offerId,
    requestedOutcome: input.requestedOutcome,
    inputPayload: input.inputPayload ?? {},
    fundingContext: input.fundingContext ?? {},
    contractContext: input.contractContext ?? null,
    metadata,
  });

  return mapCoworkerEngagementToA2aTask({
    engagementId: result.engagementId,
    offerId: input.offerId,
    serviceId: "",
    providerAgentId: "",
    requestedOutcome: input.requestedOutcome,
    status: result.status,
    inputPayload: input.inputPayload ?? {},
    approvalContext: result.approvalContext,
    metadata,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
  });
}

export async function readCoworkerA2aTask(
  taskId: string,
  deps: { db?: DbClient } = {},
): Promise<CoworkerA2aTask | null> {
  const db = deps.db ?? (prisma as unknown as DbClient);
  const engagement = await db.coworkerEngagement.findUnique({ where: { engagementId: taskId } });
  return engagement ? mapCoworkerEngagementToA2aTask(engagement) : null;
}

export function mapCoworkerEngagementToA2aTask(engagement: EngagementRow): CoworkerA2aTask {
  const metadata = record(engagement.metadata);
  const a2a = record(metadata.a2a);
  const contextId = stringValue(a2a.contextId) ?? engagement.engagementId;
  const state = mapEngagementStatus(engagement.status);
  const completed = state === "completed";

  return {
    id: engagement.engagementId,
    contextId,
    status: {
      state,
      timestamp: (engagement.completedAt ?? engagement.updatedAt).toISOString(),
      reason: state === "auth-required" ? approvalReason(engagement.approvalContext) : undefined,
    },
    providerAgentId: engagement.providerAgentId,
    offerId: engagement.offerId,
    serviceId: engagement.serviceId,
    messages: [
      {
        role: "user",
        parts: [
          { kind: "text", text: engagement.requestedOutcome },
          { kind: "data", data: engagement.inputPayload },
        ],
      },
    ],
    artifacts: completed
      ? [
          {
            artifactId: `${engagement.engagementId}:result`,
            name: "Coworker engagement result",
            parts: [{ kind: "data", data: record(engagement.metadata).result ?? {} }],
          },
        ]
      : [],
    metadata: {
      actingAgentGaid: stringValue(a2a.actingAgentGaid),
      delegatingAgentGaid: stringValue(a2a.delegatingAgentGaid),
      delegatedAgentId: engagement.providerAgentId,
      approvalContext: engagement.approvalContext,
    },
  };
}

function mapEngagementStatus(status: string): A2aTaskState {
  if (status === "needs-approval") return "auth-required";
  if (status === "accepted" || status === "in-progress") return "working";
  if (status === "completed") return "completed";
  if (status === "cancelled") return "canceled";
  if (status === "rejected") return "rejected";
  return "submitted";
}

function approvalReason(value: unknown): string | undefined {
  const approval = record(value);
  const reasons = Array.isArray(approval.reasons) ? approval.reasons.filter((entry): entry is string => typeof entry === "string") : [];
  return reasons.length > 0 ? reasons.join(", ") : undefined;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function buildA2aContextId(): string {
  return `CTX-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
}

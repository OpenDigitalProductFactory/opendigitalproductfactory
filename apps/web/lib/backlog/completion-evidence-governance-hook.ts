import { prisma } from "@dpf/db";

import { notifyAttentionLive } from "@/lib/attention/notify-live";
import type {
  ToolLifecycleDecision,
  ToolLifecycleEvent,
  ToolLifecycleHook,
} from "@/lib/mcp-governed-execute";

import {
  resolveCompletionEvidence,
  type CompletionEvidenceRuntimeDb,
  type ResolveCompletionEvidenceResult,
} from "./completion-evidence-runtime";
import type { CompletionEvidenceBlocker } from "./completion-evidence-policy";

export type CompletionEvidenceGateMode = "enforce" | "shadow" | "off";

const CIRCUIT_WINDOW_MS = 10 * 60 * 1000;
const CIRCUIT_THRESHOLD = 5;

type CircuitIdentity = {
  principalKey: string;
  apiTokenId?: string;
  agentId?: string;
  userId: string;
};

type InvalidAttemptCountInput = CircuitIdentity & {
  since: Date;
};

type ShadowInput = {
  itemRowId: string;
  userId: string;
  agentId: string | null;
  source: ToolLifecycleEvent["source"];
  callerClient: string | null;
  blockers: CompletionEvidenceBlocker[];
};

type CircuitNotificationInput = CircuitIdentity & {
  itemId: string;
  callerClient: string | null;
  blockers: CompletionEvidenceBlocker[];
};

type CompletionEvidenceHookDeps = {
  resolve: (input: {
    itemId: string;
    rawManifest: unknown;
    now: Date;
  }) => Promise<ResolveCompletionEvidenceResult>;
  countRecentInvalidAttempts: (input: InvalidAttemptCountInput) => Promise<number>;
  recordShadow: (input: ShadowInput) => Promise<void>;
  notifyCircuit: (input: CircuitNotificationInput) => Promise<void>;
  now?: () => Date;
  mode?: CompletionEvidenceGateMode;
};

export function resolveCompletionEvidenceGateMode(
  env: Record<string, string | undefined> = process.env,
): CompletionEvidenceGateMode {
  const raw = (env.DPF_COMPLETION_EVIDENCE_GATE_MODE ?? "enforce").trim().toLowerCase();
  return raw === "shadow" || raw === "off" ? raw : "enforce";
}

export function isAgentCompletionRequest(
  event: Pick<ToolLifecycleEvent, "toolName" | "rawParams" | "source" | "context">,
): boolean {
  const agentSurface = event.source !== "rest" || Boolean(event.context?.agentId);
  return (
    event.toolName === "update_backlog_item_status"
    && event.rawParams.status === "done"
    && agentSurface
  );
}

function circuitIdentity(event: ToolLifecycleEvent): CircuitIdentity {
  if (event.context?.apiTokenId) {
    return {
      principalKey: `token:${event.context.apiTokenId}`,
      apiTokenId: event.context.apiTokenId,
      userId: event.userId,
    };
  }
  if (event.context?.agentId) {
    return {
      principalKey: `agent:${event.context.agentId}`,
      agentId: event.context.agentId,
      userId: event.userId,
    };
  }
  return { principalKey: `user:${event.userId}`, userId: event.userId };
}

function blockerSummary(blockers: CompletionEvidenceBlocker[]): string {
  return blockers
    .slice(0, 4)
    .map((entry) => entry.message)
    .join("; ");
}

function denialReason(
  blockers: CompletionEvidenceBlocker[],
  nextAction: string | null,
  circuitOpen: boolean,
): string {
  const prefix = circuitOpen
    ? "Repeated unsupported completion attempts were detected; no additional items will be closed without valid evidence. "
    : "This backlog item is not complete yet. ";
  return (
    prefix
    + blockerSummary(blockers)
    + (nextAction ? ` Next action: ${nextAction}` : "")
  );
}

async function countRecentInvalidAttemptsLive(
  input: InvalidAttemptCountInput,
): Promise<number> {
  const identityWhere = input.apiTokenId
    ? { apiTokenId: input.apiTokenId }
    : input.agentId
      ? { agentId: input.agentId }
      : { userId: input.userId };
  return prisma.toolExecution.count({
    where: {
      ...identityWhere,
      toolName: "update_backlog_item_status",
      success: false,
      createdAt: { gte: input.since },
      parameters: {
        path: ["status"],
        equals: "done",
      },
    },
  });
}

async function recordShadowLive(input: ShadowInput): Promise<void> {
  const recent = await prisma.backlogItemActivity.findFirst({
    where: {
      backlogItemId: input.itemRowId,
      kind: "completion_gate_shadow",
      recordedByAgentId: input.agentId,
      recordedAt: { gte: new Date(Date.now() - CIRCUIT_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (recent) return;
  await prisma.backlogItemActivity.create({
    data: {
      backlogItemId: input.itemRowId,
      kind: "completion_gate_shadow",
      summary: `Completion evidence shadow: ${blockerSummary(input.blockers)}`.slice(0, 240),
      payload: {
        source: input.source,
        callerClient: input.callerClient,
        blockers: input.blockers,
      },
      recordedById: input.userId,
      recordedByAgentId: input.agentId,
    },
  });
}

async function notifyCircuitLive(input: CircuitNotificationInput): Promise<void> {
  const client = input.callerClient ?? "an AI client";
  await notifyAttentionLive({
    source: "platform-health",
    itemKey: `completion-evidence:${client}`,
    userId: input.userId,
    title: "AI completion claims need evidence",
    body:
      `${client} repeatedly tried to close backlog work without sufficient evidence. `
      + `${blockerSummary(input.blockers)} Review the item before granting more autonomy.`,
    deepLink: `/ops?itemId=${encodeURIComponent(input.itemId)}`,
    riskClass: "high-risk",
  });
}

function liveDeps(): CompletionEvidenceHookDeps {
  return {
    resolve: (input) =>
      resolveCompletionEvidence(prisma as unknown as CompletionEvidenceRuntimeDb, input),
    countRecentInvalidAttempts: countRecentInvalidAttemptsLive,
    recordShadow: recordShadowLive,
    notifyCircuit: notifyCircuitLive,
  };
}

export function createCompletionEvidenceGovernanceHook(
  overrides: Partial<CompletionEvidenceHookDeps> = {},
): ToolLifecycleHook {
  const deps = { ...liveDeps(), ...overrides };
  const now = deps.now ?? (() => new Date());
  return {
    id: "completion-evidence-governance",
    onPreToolUse: async (event: ToolLifecycleEvent): Promise<ToolLifecycleDecision> => {
      const mode = deps.mode ?? resolveCompletionEvidenceGateMode();
      if (mode === "off" || !isAgentCompletionRequest(event)) {
        return { decision: "allow" };
      }
      const itemId = typeof event.rawParams.itemId === "string"
        ? event.rawParams.itemId.trim()
        : "";
      if (!itemId) return { decision: "allow" };

      try {
        const evaluated = await deps.resolve({
          itemId,
          rawManifest: event.rawParams.completionEvidence,
          now: now(),
        });
        if (evaluated.kind === "not-found" || evaluated.verdict.allowed) {
          return { decision: "allow" };
        }

        if (mode === "shadow") {
          try {
            await deps.recordShadow({
              itemRowId: evaluated.item.id,
              userId: event.userId,
              agentId: event.context?.agentId ?? null,
              source: event.source,
              callerClient: event.context?.callerClient ?? null,
              blockers: evaluated.verdict.blockers,
            });
          } catch {
            // Shadow is audit-only by contract. An audit write cannot become a denial.
          }
          return {
            decision: "allow",
            reason: `completion-evidence: shadow — ${blockerSummary(evaluated.verdict.blockers)}`,
          };
        }

        const identity = circuitIdentity(event);
        const invalidAttempts = await deps.countRecentInvalidAttempts({
          ...identity,
          since: new Date(now().getTime() - CIRCUIT_WINDOW_MS),
        });
        const circuitOpen = invalidAttempts >= CIRCUIT_THRESHOLD - 1;
        if (circuitOpen) {
          try {
            await deps.notifyCircuit({
              ...identity,
              itemId,
              callerClient: event.context?.callerClient ?? null,
              blockers: evaluated.verdict.blockers,
            });
          } catch {
            // Attention is best-effort; the evidence denial remains authoritative.
          }
        }
        return {
          decision: "deny",
          reason: denialReason(
            evaluated.verdict.blockers,
            evaluated.verdict.nextAction,
            circuitOpen,
          ),
        };
      } catch {
        return {
          decision: "deny",
          reason:
            "This completion claim could not be verified by the server, so the item was not closed. "
            + "Retry after the evidence service is available; do not substitute a prose resolution.",
        };
      }
    },
  };
}

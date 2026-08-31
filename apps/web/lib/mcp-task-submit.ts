import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";
import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";
import type { UserContext } from "@/lib/permissions";
import {
  markTaskRunWorking,
  reserveTaskRunGenerationWorking,
  reserveSubmittedTaskRunWorking,
} from "@/lib/observability/heartbeat";
import {
  createAutonomousWorkRun,
  executeAutonomousWorkTool,
} from "@/lib/tak/autonomous-work-run";
import { createTaskMessage } from "@/lib/tak/task-records";
import {
  deterministicExternalTaskRunId,
  parseResourceWaitProjection,
  remoteTaskRequestDigest,
} from "./mcp-task-capacity-contract";
import { executeRemoteTaskAttempt } from "./mcp-task-execution";
import {
  recoverStaleApprovalOnReplay,
  resumeApprovedRemoteTask,
} from "./mcp-task-submit-approval-recovery";
import {
  parseInitiativeReviewBinding,
  requiredToolNames,
  validateInitiativeReviewAuthorityScope,
  type InitiativeReviewBinding,
} from "./mcp-task-review-contract";
import { createInitiativeReviewTerminalToolPolicy } from "@/lib/tak/terminal-tool-policy";
import {
  hydrateTerminalWriterContext,
  type PersistedTerminalReaderExecution,
} from "./mcp-task-terminal-writer-context";
import {
  enqueuePersistedRemoteTask,
  externalMcpTaskAsyncEnabled,
} from "./mcp-task-background-dispatch";

export {
  parseInitiativeReviewBinding,
  validateInitiativeReviewAuthorityScope,
} from "./mcp-task-review-contract";
export type { InitiativeReviewBinding } from "./mcp-task-review-contract";

export const REMOTE_RISK_CLASSES = ["read", "bounded-write", "high-risk"] as const;
export type RemoteRiskClass = (typeof REMOTE_RISK_CLASSES)[number];

export type RemoteTaskSubmitParams = {
  agentId: string;
  routeContext: string;
  title: string;
  objective: string;
  prompt: string;
  idempotencyKey: string;
  riskClass: RemoteRiskClass;
  threadId?: string | null;
  authorityScope?: string[];
  collaborationKind?: "handoff" | "summon";
  initiativeReviewBinding?: InitiativeReviewBinding;
};

export type RemoteTaskSubmitAuth = {
  tokenId: string;
  userId: string;
  capability: "read" | "write";
  source: import("@/lib/mcp/tool-tier").McpAuthSource;
};

export type RemoteTaskSubmitOutcome =
  | { kind: "invalid_params"; message: string }
  | { kind: "result"; result: Record<string, unknown> };

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function remoteTaskContent(text: string) {
  return [{ type: "text", text }];
}

export function parseRemoteTaskSubmitParams(params: Record<string, unknown> | undefined): RemoteTaskSubmitParams | string {
  if (!params) return "tasks/submit requires params";
  const agentId = optionalString(params["agentId"]);
  const routeContext = optionalString(params["routeContext"]);
  const objective = optionalString(params["objective"]);
  const prompt = optionalString(params["prompt"]);
  const idempotencyKey = optionalString(params["idempotencyKey"]);
  const riskClass = optionalString(params["riskClass"]);

  if (!agentId) return "tasks/submit requires params.agentId (string)";
  if (!routeContext) return "tasks/submit requires params.routeContext (string)";
  if (!objective) return "tasks/submit requires params.objective (string)";
  if (!prompt) return "tasks/submit requires params.prompt (string)";
  if (!idempotencyKey) return "tasks/submit requires params.idempotencyKey (string)";
  if (!riskClass || !REMOTE_RISK_CLASSES.includes(riskClass as RemoteRiskClass)) {
    return `tasks/submit requires params.riskClass (${REMOTE_RISK_CLASSES.join(" | ")})`;
  }

  const authorityScope = Array.isArray(params["authorityScope"])
    ? params["authorityScope"].filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : undefined;
  const initiativeReviewBinding = params["initiativeReviewBinding"] === undefined
    ? undefined
    : parseInitiativeReviewBinding(params["initiativeReviewBinding"]);
  if (params["initiativeReviewBinding"] !== undefined && !initiativeReviewBinding) {
    return "tasks/submit requires a valid immutable initiativeReviewBinding";
  }
  if (initiativeReviewBinding) {
    const scopeError = validateInitiativeReviewAuthorityScope(initiativeReviewBinding, authorityScope);
    if (scopeError) return `tasks/submit ${scopeError}`;
  }

  return {
    agentId,
    routeContext,
    title: optionalString(params["title"]) ?? objective.slice(0, 120),
    objective,
    prompt,
    idempotencyKey,
    riskClass: riskClass as RemoteRiskClass,
    threadId: optionalString(params["threadId"]),
    authorityScope,
    initiativeReviewBinding: initiativeReviewBinding ?? undefined,
    collaborationKind: params["collaborationKind"] === "handoff" || params["collaborationKind"] === "summon"
      ? params["collaborationKind"]
      : undefined,
  };
}

export type ExistingRemoteTask = {
  id: string;
  taskRunId: string;
  userId: string;
  threadId: string | null;
  contextId: string | null;
  status: string;
  progressPayload: unknown;
  a2aMetadata: unknown;
  lastHeartbeatAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
};

type TerminalWriterWait = {
  schemaVersion: 1;
  kind: "missing-terminal-writer";
  writerToolName: string;
  resumeMode: "same-taskrun";
  attempt: number;
  observedAt: string;
  dispatchContract?: "required-tool-call";
  noncompliance?: "prose-without-required-writer";
};

function storedRequestDigest(existing: ExistingRemoteTask): string | null {
  const metadata = existing.a2aMetadata && typeof existing.a2aMetadata === "object"
    ? existing.a2aMetadata as Record<string, unknown>
    : {};
  return optionalString(metadata["requestDigest"]);
}

function approvalEnvelopeIdFromWriterAttempt(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const row = result as Record<string, unknown>;
  if (row["success"] !== false || row["error"] !== "approval_required") return null;
  const data = row["data"];
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return optionalString((data as Record<string, unknown>)["envelopeId"]);
}

function parseTerminalWriterWait(value: unknown): TerminalWriterWait | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)["terminalWriterWait"];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const wait = candidate as Record<string, unknown>;
  if (
    wait["schemaVersion"] !== 1
    || wait["kind"] !== "missing-terminal-writer"
    || !optionalString(wait["writerToolName"])
    || wait["resumeMode"] !== "same-taskrun"
    || !Number.isInteger(wait["attempt"])
    || Number(wait["attempt"]) < 1
    || !optionalString(wait["observedAt"])
    || (wait["dispatchContract"] !== undefined && wait["dispatchContract"] !== "required-tool-call")
    || (wait["noncompliance"] !== undefined && wait["noncompliance"] !== "prose-without-required-writer")
  ) return null;
  return wait as TerminalWriterWait;
}

function replayOrConflict(existing: ExistingRemoteTask, requestDigest: string): RemoteTaskSubmitOutcome {
  const storedDigest = storedRequestDigest(existing);
  if (storedDigest && storedDigest !== requestDigest) {
    return {
      kind: "result",
      result: {
        content: remoteTaskContent(
          "This requestKey is already bound to a different external coworker request. Retry with the original immutable packet or use a new requestKey.",
        ),
        structuredContent: {
          error: "idempotency_conflict",
          action: "Retry with the original immutable packet or use a new requestKey.",
          taskRunId: existing.taskRunId,
        },
        isError: true,
      },
    };
  }
  const terminalWriterWait = parseTerminalWriterWait(existing.progressPayload);
  const resourceWait = parseResourceWaitProjection(existing.progressPayload);
  return {
    kind: "result",
    result: {
      taskRunId: existing.taskRunId,
      status: existing.status,
      idempotentReplay: true,
      requiresApproval: existing.status === "input-required" && !terminalWriterWait,
      ...(terminalWriterWait ? {
        resumable: true,
        waitReason: terminalWriterWait.kind,
      } : resourceWait ? {
        resumable: true,
        waitReason: "provider-capacity",
      } : {}),
      progressPayload: existing.progressPayload,
      a2aMetadata: existing.a2aMetadata,
    },
  };
}

async function reserveTerminalWriterReplay(input: {
  existing: ExistingRemoteTask;
  requestDigest: string;
  terminalToolPolicy: NonNullable<ReturnType<typeof createInitiativeReviewTerminalToolPolicy>>;
}): Promise<{
  wait: TerminalWriterWait;
  readerExecutions: PersistedTerminalReaderExecution[];
} | null> {
  if (storedRequestDigest(input.existing) !== input.requestDigest) return null;

  const existingWait = parseTerminalWriterWait(input.existing.progressPayload);
  const isProjectedWait = input.existing.status === "input-required" && existingWait !== null;
  const isRecoverableCompletedExit = input.existing.status === "completed" && !existingWait;
  if (!isProjectedWait && !isRecoverableCompletedExit) return null;

  const [readerExecutions, successfulWriter, writerAttempt] = await Promise.all([
    prisma.toolExecution.findMany({
      where: {
        taskRunId: input.existing.taskRunId,
        toolName: "read_source_at_version",
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        toolName: true,
        parameters: true,
        result: true,
        success: true,
        createdAt: true,
      },
    }),
    prisma.toolExecution.findFirst({
      where: {
        taskRunId: input.existing.taskRunId,
        toolName: input.terminalToolPolicy.writerToolName,
        success: true,
      },
      select: { id: true },
    }),
    prisma.toolExecution.findFirst({
      where: {
        taskRunId: input.existing.taskRunId,
        toolName: input.terminalToolPolicy.writerToolName,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, success: true, result: true },
    }),
  ]);
  if (readerExecutions.length === 0 || successfulWriter) return null;

  if (writerAttempt) {
    const proposalEnvelopeId = writerAttempt.success === false
      ? approvalEnvelopeIdFromWriterAttempt(writerAttempt.result)
      : null;
    if (!proposalEnvelopeId) return null;
    const declinedProposalEnvelope = await prisma.coworkerActionEnvelope.findFirst({
      where: {
        id: proposalEnvelopeId,
        taskRunId: input.existing.taskRunId,
        manifestActionId: input.terminalToolPolicy.writerToolName,
        status: "declined",
      },
      select: { id: true },
    });
    if (declinedProposalEnvelope?.id !== proposalEnvelopeId) return null;
  }

  const progress = input.existing.progressPayload && typeof input.existing.progressPayload === "object"
    && !Array.isArray(input.existing.progressPayload)
    ? input.existing.progressPayload as Record<string, unknown>
    : {};
  const now = new Date().toISOString();
  const wait: TerminalWriterWait = {
    schemaVersion: 1,
    kind: "missing-terminal-writer",
    writerToolName: input.terminalToolPolicy.writerToolName,
    resumeMode: "same-taskrun",
    attempt: existingWait ? existingWait.attempt + 1 : 2,
    observedAt: now,
    dispatchContract: "required-tool-call",
  };
  const reserved = await reserveTaskRunGenerationWorking({
    taskRunId: input.existing.taskRunId,
    expectedStatus: input.existing.status,
    updatedAt: input.existing.updatedAt,
    progressPayload: {
      ...progress,
      terminalWriterWait: wait,
      ...(isRecoverableCompletedExit ? { recoveredFromCompletedRouteExit: true } : {}),
      resumeReservedAt: now,
    } as Prisma.InputJsonValue,
  });
  return reserved
    ? { wait, readerExecutions: readerExecutions as PersistedTerminalReaderExecution[] }
    : null;
}

export async function resumeWaitingRemoteTask(input: {
  existing: ExistingRemoteTask;
  requestDigest: string;
  token: RemoteTaskSubmitAuth;
  userContext: UserContext;
  parsed: RemoteTaskSubmitParams;
}): Promise<RemoteTaskSubmitOutcome | null> {
  const wait = parseResourceWaitProjection(input.existing.progressPayload);
  if (input.existing.status !== "submitted" || !wait) return null;
  if (!input.existing.id || !input.existing.threadId) {
    return {
      kind: "result",
      result: {
        taskRunId: input.existing.taskRunId,
        status: input.existing.status,
        idempotentReplay: true,
        content: remoteTaskContent(
          "The original TaskRun is missing immutable execution identity and cannot be resumed.",
        ),
        structuredContent: {
          error: "stored_identity_incomplete",
          taskRunId: input.existing.taskRunId,
        },
        isError: true,
      },
    };
  }

  const progress = input.existing.progressPayload as Record<string, unknown>;
  const reserved = await reserveSubmittedTaskRunWorking({
    taskRunId: input.existing.taskRunId,
    updatedAt: input.existing.updatedAt,
    progressPayload: {
      ...progress,
      resumeReservedAt: new Date().toISOString(),
    },
  });
  if (!reserved) {
    const latest = await prisma.taskRun.findUnique({
      where: { taskRunId: input.existing.taskRunId },
      select: {
        id: true,
        taskRunId: true,
        userId: true,
        threadId: true,
        contextId: true,
        status: true,
        progressPayload: true,
        a2aMetadata: true,
        lastHeartbeatAt: true,
        completedAt: true,
        updatedAt: true,
      },
    }) as ExistingRemoteTask | null;
    return latest ? replayOrConflict(latest, input.requestDigest) : null;
  }
  return executeRemoteTaskAttempt({
    run: {
      id: input.existing.id,
      taskRunId: input.existing.taskRunId,
      contextId: input.existing.contextId,
    },
    threadId: input.existing.threadId,
    token: input.token,
    userContext: input.userContext,
    parsed: input.parsed,
    idempotentReplay: true,
    resumeKind: "capacity",
    capacityAttempt: wait.attempt + 1,
    terminalWriterAttempt: 1,
  });
}

export async function submitRemoteCoworkerTask(input: {
  token: RemoteTaskSubmitAuth;
  userContext: UserContext;
  params: Record<string, unknown> | undefined;
}): Promise<RemoteTaskSubmitOutcome> {
  const parsed = parseRemoteTaskSubmitParams(input.params);
  if (typeof parsed === "string") {
    return { kind: "invalid_params", message: parsed };
  }

  const { token, userContext } = input;
  if (token.capability === "read" && parsed.riskClass !== "read") {
    return {
      kind: "result",
      result: {
        content: remoteTaskContent(
          `This token is read-only and cannot submit ${parsed.riskClass} autonomous coworker work. Issue a write token in Admin > Platform Development > MCP, then retry.`,
        ),
        structuredContent: {
          error: "insufficient_token_scope",
          requiredScope: "write",
          tokenScope: "read",
          riskClass: parsed.riskClass,
          action: "Issue a write MCP token in Admin > Platform Development > MCP.",
        },
        isError: true,
      },
    };
  }

  const requestDigest = remoteTaskRequestDigest(parsed);
  const exactRequiredToolNames = requiredToolNames(parsed.authorityScope);
  const terminalToolPolicy = parsed.initiativeReviewBinding
    ? createInitiativeReviewTerminalToolPolicy(
        parsed.initiativeReviewBinding.writerToolName,
        exactRequiredToolNames,
        parsed.initiativeReviewBinding.artifactRef,
      )
    : null;
  const taskRunId = deterministicExternalTaskRunId(token.tokenId, parsed.idempotencyKey);
  const existingQuery: Prisma.TaskRunFindFirstArgs = {
    where: {
      userId: token.userId,
      AND: [
        { a2aMetadata: { path: ["idempotencyKey"], equals: parsed.idempotencyKey } },
        { a2aMetadata: { path: ["apiTokenId"], equals: token.tokenId } },
      ],
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      taskRunId: true,
      userId: true,
      threadId: true,
      contextId: true,
      status: true,
      progressPayload: true,
      a2aMetadata: true,
      lastHeartbeatAt: true,
      completedAt: true,
      updatedAt: true,
    },
  };
  const existing = await prisma.taskRun.findFirst(existingQuery);

  if (existing) {
    const replay = replayOrConflict(existing, requestDigest);
    if (
      storedRequestDigest(existing) === requestDigest
      && existing.status === "input-required"
    ) {
      const resumed = await resumeApprovedRemoteTask({
        existing,
        token,
        userContext,
        parsed,
      });
      if (resumed) return resumed;
    }
    if (
      storedRequestDigest(existing) === requestDigest
      && existing.status === "submitted"
    ) {
      const resumed = await resumeWaitingRemoteTask({
        existing,
        requestDigest,
        token,
        userContext,
        parsed,
      });
      if (resumed) return resumed;
    }
    if (storedRequestDigest(existing) === requestDigest && terminalToolPolicy) {
      const recovered = await recoverStaleApprovalOnReplay({
        existing,
        requestDigest,
        writerToolName: terminalToolPolicy.writerToolName,
        token,
        userContext,
        parsed,
      });
      if (recovered) return recovered;
    }
    const terminalWriterReservation = terminalToolPolicy
      ? await reserveTerminalWriterReplay({
          existing,
          requestDigest,
          terminalToolPolicy,
        })
      : null;
    if (terminalWriterReservation && terminalToolPolicy && existing.id && existing.threadId) {
      const hydration = await hydrateTerminalWriterContext({
        policy: terminalToolPolicy,
        executions: terminalWriterReservation.readerExecutions,
        readPage: async (args) => executeAutonomousWorkTool({
          toolName: "read_source_at_version",
          args,
          userId: token.userId,
          userContext,
          routeContext: parsed.routeContext,
          agentId: resolveCanonicalAgentId(parsed.agentId),
          threadId: existing.threadId!,
          taskRunId: existing.taskRunId,
          apiTokenId: token.tokenId,
          tokenScope: token.capability,
          externalAccessEnabled: true,
        }),
      });
      const priorProgress = existing.progressPayload && typeof existing.progressPayload === "object"
        && !Array.isArray(existing.progressPayload)
        ? existing.progressPayload as Record<string, unknown>
        : {};
      if (!hydration.ok) {
        await prisma.taskRun.update({
          where: { taskRunId: existing.taskRunId },
          data: {
            status: "input-required",
            completedAt: null,
            progressPayload: {
              ...priorProgress,
              terminalWriterWait: terminalWriterReservation.wait,
              resumeReservedAt: terminalWriterReservation.wait.observedAt,
              ...(existing.status === "completed" ? { recoveredFromCompletedRouteExit: true } : {}),
              terminalWriterContextFailure: {
                code: hydration.code,
                message: hydration.error,
                observedAt: new Date().toISOString(),
              },
            },
          },
        });
        return {
          kind: "result",
          result: {
            taskRunId: existing.taskRunId,
            status: "input-required",
            idempotentReplay: true,
            resumedFromTerminalWriterWait: false,
            requiresApproval: false,
            resumable: true,
            waitReason: "terminal-writer-context-unavailable",
            content: remoteTaskContent(hydration.error),
            structuredContent: { error: hydration.code },
            isError: true,
          },
        };
      }
      await prisma.taskRun.update({
        where: { taskRunId: existing.taskRunId },
        data: {
          progressPayload: {
            ...priorProgress,
            terminalWriterWait: terminalWriterReservation.wait,
            resumeReservedAt: terminalWriterReservation.wait.observedAt,
            ...(existing.status === "completed" ? { recoveredFromCompletedRouteExit: true } : {}),
            terminalWriterContext: {
              schemaVersion: 1,
              readerExecutionIds: hydration.data.readerExecutionIds,
              hydratedPageCount: hydration.data.hydratedPageCount,
              hydratedCharCount: hydration.data.hydratedCharCount,
              hydratedAt: new Date().toISOString(),
            },
          },
        },
      });
      await markTaskRunWorking(existing.taskRunId);
      return executeRemoteTaskAttempt({
        run: {
          id: existing.id,
          taskRunId: existing.taskRunId,
          contextId: existing.contextId,
        },
        threadId: existing.threadId,
        token,
        userContext,
        parsed,
        idempotentReplay: true,
        resumeKind: "terminal-writer",
        terminalWriterContext: hydration.data.context,
        capacityAttempt: 1,
        terminalWriterAttempt: terminalWriterReservation.wait.attempt,
      });
    }
    return replay;
  }

  const contextKey = parsed.threadId ?? `mcp:${token.tokenId}:${parsed.idempotencyKey}`;
  const thread = await prisma.agentThread.upsert({
    where: { userId_contextKey: { userId: token.userId, contextKey } },
    update: {},
    create: { userId: token.userId, contextKey },
    select: { id: true },
  });

  const sourceKind = token.source === "session-jwt" ? "mcp-session" : "mcp-token";
  let run: Awaited<ReturnType<typeof createAutonomousWorkRun>>;
  try {
    run = await createAutonomousWorkRun({
      trigger: "external-mcp",
      taskRunId,
      userId: token.userId,
      agentId: parsed.agentId,
      routeContext: parsed.routeContext,
      title: parsed.title,
      objective: parsed.objective,
      prompt: parsed.prompt,
      threadId: thread.id,
      authorityScope: parsed.authorityScope ?? [],
      sourceRef: { kind: sourceKind, id: token.tokenId },
      metadata: {
        idempotencyKey: parsed.idempotencyKey,
        requestDigest,
        collaborationKind: parsed.collaborationKind ?? null,
        riskClass: parsed.riskClass,
        apiTokenId: token.tokenId,
        tokenSource: token.source,
        tokenCapability: token.capability,
        requestedAgentId: parsed.agentId,
        requestedThreadId: parsed.threadId ?? null,
        initiativeReviewBinding: parsed.initiativeReviewBinding ?? null,
      },
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const concurrent = await prisma.taskRun.findFirst(existingQuery);
      if (concurrent) return replayOrConflict(concurrent, requestDigest);
    }
    throw error;
  }

  await createTaskMessage({
    taskRunId: run.taskRunId,
    taskRunRecordId: run.id,
    contextId: run.contextId,
    role: "user",
    content: parsed.prompt,
    metadata: {
      source: "mcp.tasks/submit",
      idempotencyKey: parsed.idempotencyKey,
      riskClass: parsed.riskClass,
      apiTokenId: token.tokenId,
    },
  });

  if (parsed.riskClass === "high-risk") {
    await prisma.taskRun.update({
      where: { taskRunId: run.taskRunId },
      data: {
        status: "input-required",
        progressPayload: {
          summary: "Remote submission paused for employee approval before side-effecting work can run.",
          riskClass: parsed.riskClass,
          requiresApproval: true,
        },
      },
    });

    return {
      kind: "result",
      result: {
        taskRunId: run.taskRunId,
        status: "input-required",
        idempotentReplay: false,
        requiresApproval: true,
        content: remoteTaskContent("Remote task submitted and paused for employee approval."),
        isError: false,
      },
    };
  }

  if (externalMcpTaskAsyncEnabled()) {
    const dispatch = await enqueuePersistedRemoteTask({ taskRunId: run.taskRunId });
    return {
      kind: "result",
      result: {
        taskRunId: run.taskRunId,
        status: "submitted",
        idempotentReplay: false,
        requiresApproval: false,
        asynchronous: true,
        dispatchEventId: dispatch.eventId,
        dispatchQueued: dispatch.queued,
        pollInterval: 2_000,
        content: remoteTaskContent(
          dispatch.queued
            ? "Remote task accepted for background execution. Subscribe for task updates or reconcile with tasks/get."
            : "Remote task persisted; background dispatch is pending reconciliation.",
        ),
        ...(dispatch.error
          ? { structuredContent: { dispatchState: "pending-reconciliation", error: dispatch.error } }
          : {}),
        isError: false,
      },
    };
  }

  return executeRemoteTaskAttempt({
    run,
    threadId: thread.id,
    token,
    userContext,
    parsed,
    idempotentReplay: false,
    capacityAttempt: 1,
    terminalWriterAttempt: 1,
  });
}

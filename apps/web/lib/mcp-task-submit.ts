import { prisma } from "@dpf/db";
import { withTaskRunApprovalLocation } from "./mcp/external-approval-location-lookup";
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
  REMOTE_TASK_REQUEST_DIGEST_VERSION,
  matchingRemoteTaskRequestDigest,
  remoteTaskRequestDigest,
  remoteTaskRequestMatches,
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
  enqueuePersistedRemoteTaskSubmission,
  externalMcpTaskAsyncEnabled,
  initialRemoteTaskDispatchProjection,
} from "./mcp-task-background-dispatch";
import { tasksLifecycleEnabled } from "./mcp/tasks-lifecycle";
import {
  createTerminalWriterEscalation,
  recoverTerminalWriterEscalation,
  terminalWriterEscalationMessage,
  terminalWriterEscalationStructuredContent,
  terminalWriterEscalationWaitReason,
} from "./mcp-task-terminal-writer-escalation";
import {
  parseTerminalWriterWait,
  projectRemoteTaskReplay,
  type TerminalWriterWait,
} from "./mcp-task-replay-projection";
import { durableInferenceTaskMetadata, parseDurableInferenceTaskRecipeId, type DurableInferenceTaskRecipeId } from "./mcp-task-durable-inference-contract";
export {
  parseInitiativeReviewBinding,
  validateInitiativeReviewAuthorityScope,
} from "./mcp-task-review-contract";
export type { InitiativeReviewBinding } from "./mcp-task-review-contract";

async function persistedTerminalReaderExecutions(
  taskRunId: string,
): Promise<PersistedTerminalReaderExecution[]> {
  return prisma.toolExecution.findMany({
    where: {
      taskRunId,
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
  }) as Promise<PersistedTerminalReaderExecution[]>;
}

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
  recipeId?: DurableInferenceTaskRecipeId;
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

const DURABLE_INFERENCE_SUBMIT_KEYS = new Set([
  "agentId",
  "routeContext",
  "title",
  "objective",
  "prompt",
  "idempotencyKey",
  "riskClass",
  "threadId",
  "authorityScope",
  "collaborationKind",
  "initiativeReviewBinding",
  "recipeId",
]);

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
  const durableRecipe = parseDurableInferenceTaskRecipeId(params["recipeId"]);
  if (!agentId) return "tasks/submit requires params.agentId (string)";
  if (!routeContext) return "tasks/submit requires params.routeContext (string)";
  if (!objective) return "tasks/submit requires params.objective (string)";
  if (!prompt) return "tasks/submit requires params.prompt (string)";
  if (!idempotencyKey) return "tasks/submit requires params.idempotencyKey (string)";
  if (!riskClass || !REMOTE_RISK_CLASSES.includes(riskClass as RemoteRiskClass)) return `tasks/submit requires params.riskClass (${REMOTE_RISK_CLASSES.join(" | ")})`;
  if (!durableRecipe.ok) return durableRecipe.error;
  const durableRecipeId = durableRecipe.data.recipeId;
  if (durableRecipeId) {
    const unknownKey = Object.keys(params).find((key) => !DURABLE_INFERENCE_SUBMIT_KEYS.has(key));
    if (unknownKey) return `tasks/submit durable-inference recipe does not accept params.${unknownKey}`;
  }
  if (durableRecipeId && riskClass !== "read") return "tasks/submit durable-inference recipe requires params.riskClass read";

  const authorityScope = Array.isArray(params["authorityScope"])
    ? params["authorityScope"].filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : undefined;
  const initiativeReviewBinding = params["initiativeReviewBinding"] === undefined
    ? undefined
    : parseInitiativeReviewBinding(params["initiativeReviewBinding"]);
  if (params["initiativeReviewBinding"] !== undefined && !initiativeReviewBinding) return "tasks/submit requires a valid immutable initiativeReviewBinding";
  if (durableRecipeId && (initiativeReviewBinding || (authorityScope?.length ?? 0) > 0)) return "tasks/submit durable-inference recipe does not accept tool authority or initiative review bindings";
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
    ...(durableRecipeId ? { recipeId: durableRecipeId } : {}),
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

function approvalEnvelopeIdFromWriterAttempt(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const row = result as Record<string, unknown>;
  if (row["success"] !== false || row["error"] !== "approval_required") return null;
  const data = row["data"];
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return optionalString((data as Record<string, unknown>)["envelopeId"]);
}

function replayOrConflict(existing: ExistingRemoteTask, parsed: RemoteTaskSubmitParams): RemoteTaskSubmitOutcome {
  const metadata = existing.a2aMetadata && typeof existing.a2aMetadata === "object"
    && !Array.isArray(existing.a2aMetadata)
    ? existing.a2aMetadata as Record<string, unknown>
    : null;
  const hasStoredDigest = optionalString(metadata?.["requestDigest"]) !== null;
  return projectRemoteTaskReplay({
    existing,
    // Rows from before immutable request digests preserve the historical
    // idempotent projection. Versioned rows must match their exact packet.
    requestMatches: !hasStoredDigest || remoteTaskRequestMatches(existing.a2aMetadata, parsed),
  });
}

async function reserveTerminalWriterReplay(input: {
  existing: ExistingRemoteTask;
  parsed: RemoteTaskSubmitParams;
  terminalToolPolicy: NonNullable<ReturnType<typeof createInitiativeReviewTerminalToolPolicy>>;
}): Promise<{
  wait: TerminalWriterWait;
  readerExecutions: PersistedTerminalReaderExecution[];
  bootstrapReaderEvidence: boolean;
} | null> {
  if (!remoteTaskRequestMatches(input.existing.a2aMetadata, input.parsed)) return null;
  if (recoverTerminalWriterEscalation(input.existing.progressPayload)) return null;

  const existingWait = parseTerminalWriterWait(input.existing.progressPayload);
  const isProjectedWait = existingWait !== null
    && ["input-required", "stalled", "failed"].includes(input.existing.status);
  const isRecoverableCompletedExit = input.existing.status === "completed" && !existingWait;
  if (!isProjectedWait && !isRecoverableCompletedExit) return null;
  if (existingWait && existingWait.writerToolName !== input.terminalToolPolicy.writerToolName) return null;

  const [readerExecutions, successfulWriter, writerAttempt] = await Promise.all([
    persistedTerminalReaderExecutions(input.existing.taskRunId),
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
  if (successfulWriter) return null;
  const bootstrapReaderEvidence = readerExecutions.length === 0;
  if (bootstrapReaderEvidence && !isProjectedWait) return null;

  if (writerAttempt) {
    const proposalEnvelopeId = writerAttempt.success === false
      ? approvalEnvelopeIdFromWriterAttempt(writerAttempt.result)
      : null;
    if (proposalEnvelopeId) {
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
    } else if (
      writerAttempt.success !== false
      || !existingWait
      || !["stalled", "failed"].includes(input.existing.status)
    ) return null;
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
    ? { wait, readerExecutions, bootstrapReaderEvidence }
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
    return latest ? replayOrConflict(latest, input.parsed) : null;
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
  if (parsed.recipeId && !tasksLifecycleEnabled()) {
    return {
      kind: "invalid_params",
      message: "tasks/submit durable-inference recipe requires the MCP Tasks lifecycle surface",
    };
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
  const durableInitialDispatch = parsed.recipeId
    ? initialRemoteTaskDispatchProjection(taskRunId, new Date())
    : null;
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
    const matchedRequestDigest = matchingRemoteTaskRequestDigest(existing.a2aMetadata, parsed);
    const requestMatches = matchedRequestDigest !== null;
    const replay = replayOrConflict(existing, parsed);
    if (
      requestMatches
      && recoverTerminalWriterEscalation(existing.progressPayload)
    ) return replay;
    if (
      requestMatches
      && (existing.status === "input-required" || (existing.status === "completed" && terminalToolPolicy))
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
      requestMatches
      && existing.status === "submitted"
    ) {
      const resumed = await resumeWaitingRemoteTask({
        existing,
        requestDigest: matchedRequestDigest ?? requestDigest,
        token,
        userContext,
        parsed,
      });
      if (resumed) return resumed;
    }
    if (requestMatches && terminalToolPolicy) {
      const recovered = await recoverStaleApprovalOnReplay({
        existing,
        requestDigest: matchedRequestDigest ?? requestDigest,
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
          parsed,
          terminalToolPolicy,
        })
      : null;
    if (terminalWriterReservation && terminalToolPolicy && existing.id && existing.threadId) {
      let readerExecutions = terminalWriterReservation.readerExecutions;
      let bootstrapFailure: { ok: false; code: string; error: string } | null = null;
      if (terminalWriterReservation.bootstrapReaderEvidence) {
        const immutableReaderArguments = terminalToolPolicy.immutableReaderArguments;
        if (!immutableReaderArguments) {
          bootstrapFailure = {
            ok: false,
            code: "terminal_writer_context_reader_failed",
            error: "The terminal writer policy does not contain an immutable reader binding.",
          };
        } else {
          const bootstrapRead = await executeAutonomousWorkTool({
            toolName: "read_source_at_version",
            args: {
              ...immutableReaderArguments,
              startLine: 1,
              maxLines: 200,
              maxChars: 3_200,
            },
            userId: token.userId,
            userContext,
            routeContext: parsed.routeContext,
            agentId: resolveCanonicalAgentId(parsed.agentId),
            threadId: existing.threadId,
            taskRunId: existing.taskRunId,
            apiTokenId: token.tokenId,
            tokenScope: token.capability,
            externalAccessEnabled: true,
          });
          if (!bootstrapRead.success) {
            bootstrapFailure = {
              ok: false,
              code: "terminal_writer_context_reader_failed",
              error: bootstrapRead.message || "The governed immutable bootstrap read failed.",
            };
          } else {
            readerExecutions = await persistedTerminalReaderExecutions(existing.taskRunId);
          }
        }
      }
      const hydration = bootstrapFailure ?? await hydrateTerminalWriterContext({
        policy: terminalToolPolicy,
        executions: readerExecutions,
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
        const escalation = hydration.code === "terminal_writer_context_truncated"
          ? createTerminalWriterEscalation({
              code: "terminal_writer_context_truncated",
              writerToolName: terminalToolPolicy.writerToolName,
              attempt: terminalWriterReservation.wait.attempt,
            })
          : null;
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
              ...(escalation ? { terminalWriterEscalation: escalation } : {}),
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
            resumable: escalation ? false : true,
            waitReason: escalation
              ? terminalWriterEscalationWaitReason(escalation)
              : "terminal-writer-context-unavailable",
            content: remoteTaskContent(
              escalation ? terminalWriterEscalationMessage(escalation) : hydration.error,
            ),
            structuredContent: escalation
              ? terminalWriterEscalationStructuredContent(escalation)
              : { error: hydration.code },
            isError: escalation ? false : true,
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
        requestDigestVersion: REMOTE_TASK_REQUEST_DIGEST_VERSION,
        collaborationKind: parsed.collaborationKind ?? null,
        riskClass: parsed.riskClass,
        apiTokenId: token.tokenId,
        tokenSource: token.source,
        tokenCapability: token.capability,
        requestedAgentId: parsed.agentId,
        requestedThreadId: parsed.threadId ?? null,
        initiativeReviewBinding: parsed.initiativeReviewBinding ?? null,
        ...(parsed.recipeId ? { durableInference: durableInferenceTaskMetadata(parsed.recipeId) } : {}),
      },
      ...(parsed.recipeId && durableInitialDispatch ? {
        deferredSubmission: {
          content: parsed.prompt,
          metadata: {
            source: "mcp.tasks/submit",
            idempotencyKey: parsed.idempotencyKey,
            riskClass: parsed.riskClass,
            apiTokenId: token.tokenId,
          },
          progressPayload: { dispatch: durableInitialDispatch },
        },
      } : {}),
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const concurrent = await prisma.taskRun.findFirst(existingQuery);
      if (concurrent) return replayOrConflict(concurrent, parsed);
    }
    throw error;
  }

  if (!parsed.recipeId) {
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
  }

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
      result: await withTaskRunApprovalLocation({
        taskRunId: run.taskRunId,
        status: "input-required",
        idempotentReplay: false,
        requiresApproval: true,
        content: remoteTaskContent("Remote task submitted and paused for employee approval."),
        isError: false,
      }, { taskRunId: run.taskRunId, callerUserId: token.userId }),
    };
  }

  if (parsed.recipeId || externalMcpTaskAsyncEnabled()) {
    return {
      kind: "result",
      result: await enqueuePersistedRemoteTaskSubmission(run.taskRunId, {
        projectionAlreadyPersisted: Boolean(parsed.recipeId),
      }),
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

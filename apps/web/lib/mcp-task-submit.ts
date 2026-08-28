import { coworkerBriefSpans } from "@/lib/tak/coworker-prompt-provenance";
import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";
import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";
import { createHash } from "crypto";
import type { UserContext } from "@/lib/permissions";
import { markTaskRunWorking } from "@/lib/observability/heartbeat";
import {
  narrowInitiativeReviewTools,
  parseInitiativeReviewBinding,
  requiredToolNames,
  requiresInitiativeReviewEffort,
  validateInitiativeReviewAuthorityScope,
  type InitiativeReviewBinding,
} from "@/lib/mcp-task-review-contract";
import { createAutonomousWorkRun, executeAutonomousAgenticLoop, executeAutonomousWorkTool, resolveAutonomousWorkAgent, resolveAutonomousWorkTools } from "@/lib/tak/autonomous-work-run";
import { createTaskMessage } from "@/lib/tak/task-records";
import { deriveEffortWarrant } from "@/lib/tak/effort-warrant";
import { createInitiativeReviewTerminalToolPolicy } from "@/lib/tak/terminal-tool-policy";

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

export {
  parseInitiativeReviewBinding,
  validateInitiativeReviewAuthorityScope,
  type InitiativeReviewBinding,
} from "@/lib/mcp-task-review-contract";

export type RemoteTaskSubmitAuth = {
  tokenId: string;
  userId: string;
  capability: "read" | "write";
  source: "pat" | "session-jwt";
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

function stableDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function deterministicExternalTaskRunId(tokenId: string, idempotencyKey: string): string {
  // `tokenId` is the server-owned McpApiToken row id, not the bearer secret.
  // Keep it out of a password-shaped fast hash: CodeQL correctly cannot infer
  // that distinction across the auth boundary. The reversible base64url
  // namespace preserves per-token isolation while only the caller-controlled,
  // non-secret request key is digested to keep the public id bounded.
  const tokenNamespace = Buffer.from(tokenId, "utf8").toString("base64url");
  const suffix = createHash("sha256")
    .update(idempotencyKey)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `TR-MCP-${tokenNamespace}-${suffix}`;
}

type ExistingRemoteTask = {
  id: string;
  taskRunId: string;
  threadId: string | null;
  contextId: string | null;
  status: string;
  progressPayload: unknown;
  a2aMetadata: unknown;
  updatedAt: Date;
};

type TerminalWriterWait = {
  schemaVersion: 1;
  kind: "missing-terminal-writer";
  writerToolName: string;
  resumeMode: "same-taskrun";
  attempt: number;
  observedAt: string;
};

type ApprovedRemoteTaskEnvelope = {
  id: string;
  threadId: string;
  manifestActionId: string;
};

const GOVERNED_AUDIT_PARAMETER_KEYS = new Set([
  "_surface",
  "_takAlignment",
  "_takPrecondition",
]);

function originalToolParameters(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !GOVERNED_AUDIT_PARAMETER_KEYS.has(key)),
  );
}

function storedRequestDigest(existing: ExistingRemoteTask): string | null {
  const metadata = existing.a2aMetadata && typeof existing.a2aMetadata === "object"
    ? existing.a2aMetadata as Record<string, unknown>
    : {};
  return optionalString(metadata["requestDigest"]);
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
  return {
    kind: "result",
    result: {
      taskRunId: existing.taskRunId,
      status: existing.status,
      idempotentReplay: true,
      requiresApproval: existing.status === "input-required" && !terminalWriterWait,
      ...(terminalWriterWait ? {
        resumable: terminalWriterWait.attempt < 2,
        waitReason: terminalWriterWait.kind,
      } : {}),
      progressPayload: existing.progressPayload,
      a2aMetadata: existing.a2aMetadata,
    },
  };
}

type TerminalWriterReplayReservation = {
  wait: TerminalWriterWait;
};

async function reserveTerminalWriterReplay(input: {
  existing: ExistingRemoteTask;
  requestDigest: string;
  terminalToolPolicy: NonNullable<ReturnType<typeof createInitiativeReviewTerminalToolPolicy>>;
}): Promise<TerminalWriterReplayReservation | null> {
  if (storedRequestDigest(input.existing) !== input.requestDigest) return null;

  const existingWait = parseTerminalWriterWait(input.existing.progressPayload);
  const isProjectedWait = input.existing.status === "input-required" && existingWait?.attempt === 1;
  const isRecoverableCompletedExit = input.existing.status === "completed" && !existingWait;
  if (!isProjectedWait && !isRecoverableCompletedExit) return null;

  if (isRecoverableCompletedExit) {
    const [successfulReader, writerAttempt] = await Promise.all([
      prisma.toolExecution.findFirst({
        where: {
          taskRunId: input.existing.taskRunId,
          toolName: { in: [...input.terminalToolPolicy.readerToolNames] },
          success: true,
        },
        select: { id: true },
      }),
      prisma.toolExecution.findFirst({
        where: {
          taskRunId: input.existing.taskRunId,
          toolName: input.terminalToolPolicy.writerToolName,
        },
        select: { id: true },
      }),
    ]);
    if (!successfulReader || writerAttempt) return null;
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
    attempt: 2,
    observedAt: now,
  };
  const reservation = await prisma.taskRun.updateMany({
    where: {
      taskRunId: input.existing.taskRunId,
      status: input.existing.status,
      updatedAt: input.existing.updatedAt,
    },
    data: {
      ...(isRecoverableCompletedExit ? { status: "input-required" } : {}),
      completedAt: null,
      progressPayload: {
        ...progress,
        terminalWriterWait: wait,
        ...(isRecoverableCompletedExit ? { recoveredFromCompletedRouteExit: true } : {}),
        resumeReservedAt: now,
      },
    },
  });
  return reservation.count === 1
    ? { wait }
    : null;
}

async function resumeApprovedRemoteTask(input: {
  existing: ExistingRemoteTask;
  token: RemoteTaskSubmitAuth;
  userContext: UserContext;
  parsed: RemoteTaskSubmitParams;
}): Promise<RemoteTaskSubmitOutcome | null> {
  if (input.existing.status !== "input-required") return null;

  const envelope = await prisma.coworkerActionEnvelope.findFirst({
    where: {
      taskRunId: input.existing.taskRunId,
      delegatingUserId: input.token.userId,
      status: "approved",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, threadId: true, manifestActionId: true },
  }) as ApprovedRemoteTaskEnvelope | null;
  if (!envelope) return null;

  const proposedExecution = await prisma.toolExecution.findFirst({
    where: {
      taskRunId: input.existing.taskRunId,
      toolName: envelope.manifestActionId,
      success: false,
      result: { path: ["data", "envelopeId"], equals: envelope.id },
    },
    orderBy: { createdAt: "desc" },
    select: { parameters: true },
  });
  const args = originalToolParameters(proposedExecution?.parameters);
  if (!args) return null;

  const reservation = await prisma.taskRun.updateMany({
    where: {
      taskRunId: input.existing.taskRunId,
      status: "input-required",
      updatedAt: input.existing.updatedAt,
    },
    data: {
      progressPayload: {
        ...(input.existing.progressPayload && typeof input.existing.progressPayload === "object"
          && !Array.isArray(input.existing.progressPayload)
          ? input.existing.progressPayload as Record<string, unknown>
          : {}),
        approvalResumeReserved: true,
      },
    },
  });
  if (reservation.count !== 1) return null;
  await markTaskRunWorking(input.existing.taskRunId);

  const result = await executeAutonomousWorkTool({
    toolName: envelope.manifestActionId,
    args,
    userId: input.token.userId,
    userContext: input.userContext,
    routeContext: input.parsed.routeContext,
    agentId: resolveCanonicalAgentId(input.parsed.agentId),
    threadId: envelope.threadId,
    taskRunId: input.existing.taskRunId,
    apiTokenId: input.token.tokenId,
    tokenScope: input.token.capability,
    externalAccessEnabled: true,
  });
  const currentRun = await prisma.taskRun.findUnique({
    where: { taskRunId: input.existing.taskRunId },
    select: { status: true },
  });
  const status = currentRun?.status === "input-required"
    ? "input-required"
    : result.success ? "completed" : "failed";
  await prisma.taskRun.update({
    where: { taskRunId: input.existing.taskRunId },
    data: {
      status,
      ...(status === "input-required" ? {} : { completedAt: new Date() }),
      progressPayload: {
        summary: result.message,
        riskClass: input.parsed.riskClass,
        executedToolCount: 1,
        resumedFromApproval: true,
      },
    },
  });

  return {
    kind: "result",
    result: {
      taskRunId: input.existing.taskRunId,
      status,
      idempotentReplay: true,
      resumedFromApproval: true,
      requiresApproval: status === "input-required",
      executedToolCount: 1,
      content: remoteTaskContent(result.message),
      isError: status === "failed",
      ...(result.entityId ? { entityId: result.entityId } : {}),
    },
  };
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

  const requestDigest = stableDigest({
    agentId: parsed.agentId,
    routeContext: parsed.routeContext,
    title: parsed.title,
    objective: parsed.objective,
    prompt: parsed.prompt,
    riskClass: parsed.riskClass,
    authorityScope: [...(parsed.authorityScope ?? [])].sort(),
    collaborationKind: parsed.collaborationKind ?? null,
    ...(parsed.initiativeReviewBinding
      ? { initiativeReviewBinding: parsed.initiativeReviewBinding }
      : {}),
  });
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
      threadId: true,
      contextId: true,
      status: true,
      progressPayload: true,
      a2aMetadata: true,
      updatedAt: true,
    },
  };
  const existing = await prisma.taskRun.findFirst(existingQuery);
  let thread: { id: string };
  let run: Awaited<ReturnType<typeof createAutonomousWorkRun>> | {
    id: string;
    taskRunId: string;
    contextId: string | null;
  };
  let idempotentReplay = false;
  let terminalWriterAttempt = 1;
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
    const reservation = terminalToolPolicy
      ? await reserveTerminalWriterReplay({
        existing,
        requestDigest,
        terminalToolPolicy,
      })
      : null;
    if (!reservation || !existing.id || !existing.threadId) return replay;
    await markTaskRunWorking(existing.taskRunId);
    run = {
      id: existing.id,
      taskRunId: existing.taskRunId,
      contextId: existing.contextId,
    };
    thread = { id: existing.threadId };
    idempotentReplay = true;
    terminalWriterAttempt = reservation.wait.attempt;
  } else {
    const contextKey = parsed.threadId ?? `mcp:${token.tokenId}:${parsed.idempotencyKey}`;
    thread = await prisma.agentThread.upsert({
      where: { userId_contextKey: { userId: token.userId, contextKey } },
      update: {},
      create: { userId: token.userId, contextKey },
      select: { id: true },
    });

    const sourceKind = token.source === "session-jwt" ? "mcp-session" : "mcp-token";
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
  }

  const agent = await resolveAutonomousWorkAgent({
    agentId: parsed.agentId,
    routeContext: parsed.routeContext,
    userContext,
  });
  // Keep grants and attribution on the canonical coworker when prompt lookup returns a legacy slug.
  const modelRoutingAgentId = agent.agentId ?? parsed.agentId;
  const resolvedAgentId = resolveCanonicalAgentId(modelRoutingAgentId);
  const routingConfig = await prisma.agentModelConfig?.findUnique({
    where: { agentId: modelRoutingAgentId },
    select: {
      minimumTier: true,
      budgetClass: true,
      pinnedProviderId: true,
      pinnedModelId: true,
    },
  }).catch(() => null) ?? null;
  const modelRequirements = routingConfig
    ? {
        defaultMinimumTier: routingConfig.minimumTier,
        defaultBudgetClass: routingConfig.budgetClass,
        ...(routingConfig.pinnedProviderId
          ? { preferredProviderId: routingConfig.pinnedProviderId }
          : {}),
        ...(routingConfig.pinnedModelId
          ? { preferredModelId: routingConfig.pinnedModelId }
          : {}),
        ...(routingConfig.pinnedProviderId === "local"
          ? { residencyPolicy: "local_only" as const }
          : {}),
      }
    : null;
  const toolMode = parsed.riskClass === "read" ? "advise" : "act";
  const resolvedTools = await resolveAutonomousWorkTools({
    userContext,
    agentId: resolvedAgentId,
    mode: toolMode,
    externalAccessEnabled: true,
    // Budget attachment to the serving model; the remote prompt ranks the retained tools.
    routeContext: parsed.routeContext,
    intentQuery: parsed.prompt,
    requiredToolNames: exactRequiredToolNames,
  });
  const tools = narrowInitiativeReviewTools(
    resolvedTools,
    exactRequiredToolNames,
    parsed.initiativeReviewBinding,
  );
  const effortWarrant = requiresInitiativeReviewEffort(exactRequiredToolNames)
    ? deriveEffortWarrant({
        reasoningDepth: "high",
        availableToolNames: [...tools.tools.map((tool) => tool.name), ...tools.deferredTools.map((tool) => tool.name)],
        messageChars: parsed.prompt.length,
      })
    : undefined;

  try {
    const result = await executeAutonomousAgenticLoop({
      systemPrompt: agent.systemPrompt,
      systemPromptInstructionSpans: coworkerBriefSpans(agent.systemPrompt),
      chatHistory: [{ role: "user", content: parsed.prompt }],
      sensitivity: agent.sensitivity ?? "internal",
      tools: tools.tools,
      toolsForProvider: tools.toolsForProvider,
      deferredTools: tools.deferredTools,
      userId: token.userId,
      routeContext: parsed.routeContext,
      agentId: resolvedAgentId,
      threadId: thread.id,
      taskRunId: run.taskRunId,
      apiTokenId: token.tokenId,
      taskType: "external-mcp",
      agentDisplayName: optionalString(agent.displayName) ?? resolvedAgentId,
      ...(effortWarrant ? { effortWarrant } : {}),
      ...(terminalToolPolicy ? { terminalToolPolicy } : {}),
      ...(modelRequirements ? { modelRequirements } : {}),
    });

    await createTaskMessage({
      taskRunId: run.taskRunId,
      taskRunRecordId: run.id,
      contextId: run.contextId,
      role: "assistant",
      content: result.content,
      metadata: {
        source: "mcp.tasks/submit",
        executedToolCount: result.executedTools?.length ?? 0,
      },
    });

    const currentRun = parsed.riskClass === "read"
      ? null
      : await prisma.taskRun.findUnique({
          where: { taskRunId: run.taskRunId },
          select: { status: true },
        });
    if (result.failure?.kind === "terminal-writer-missing" && terminalToolPolicy) {
      const progressPayload = {
        summary: result.failure.message,
        riskClass: parsed.riskClass,
        executedToolCount: result.executedTools?.length ?? 0,
        terminalWriterWait: {
          schemaVersion: 1,
          kind: "missing-terminal-writer",
          writerToolName: terminalToolPolicy.writerToolName,
          resumeMode: "same-taskrun",
          attempt: terminalWriterAttempt,
          observedAt: new Date().toISOString(),
        },
      };
      await prisma.taskRun.update({
        where: { taskRunId: run.taskRunId },
        data: { status: "input-required", completedAt: null, progressPayload },
      });
      return {
        kind: "result",
        result: {
          taskRunId: run.taskRunId,
          status: "input-required",
          idempotentReplay,
          ...(idempotentReplay ? { resumedFromTerminalWriterWait: true } : {}),
          requiresApproval: false,
          resumable: terminalWriterAttempt < 2,
          waitReason: "missing-terminal-writer",
          content: remoteTaskContent(result.content),
          executedToolCount: result.executedTools?.length ?? 0,
          isError: false,
        },
      };
    }
    if (currentRun?.status === "input-required") {
      return {
        kind: "result",
        result: {
          taskRunId: run.taskRunId,
          status: "input-required",
          idempotentReplay,
          ...(idempotentReplay ? { resumedFromTerminalWriterWait: true } : {}),
          requiresApproval: true,
          content: remoteTaskContent(result.content),
          executedToolCount: result.executedTools?.length ?? 0,
          isError: false,
        },
      };
    }

    await prisma.taskRun.update({
      where: { taskRunId: run.taskRunId },
      data: {
        status: "completed",
        completedAt: new Date(),
        progressPayload: {
          summary: result.content,
          riskClass: parsed.riskClass,
          executedToolCount: result.executedTools?.length ?? 0,
        },
      },
    });

    return {
      kind: "result",
      result: {
        taskRunId: run.taskRunId,
        status: "completed",
        idempotentReplay,
        ...(idempotentReplay ? { resumedFromTerminalWriterWait: true } : {}),
        requiresApproval: false,
        content: remoteTaskContent(result.content),
        executedToolCount: result.executedTools?.length ?? 0,
        isError: false,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown remote coworker execution error";
    await prisma.taskRun.update({
      where: { taskRunId: run.taskRunId },
      data: {
        status: "failed",
        completedAt: new Date(),
        progressPayload: {
          summary: message,
          riskClass: parsed.riskClass,
        },
      },
    });
    return {
      kind: "result",
      result: {
        taskRunId: run.taskRunId,
        status: "failed",
        idempotentReplay,
        ...(idempotentReplay ? { resumedFromTerminalWriterWait: true } : {}),
        requiresApproval: false,
        content: remoteTaskContent(message),
        isError: true,
      },
    };
  }
}

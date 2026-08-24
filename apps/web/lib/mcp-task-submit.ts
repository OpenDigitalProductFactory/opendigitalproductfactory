import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";
import { createHash } from "crypto";
import type { UserContext } from "@/lib/permissions";
import {
  createAutonomousWorkRun,
  executeAutonomousAgenticLoop,
  resolveAutonomousWorkAgent,
  resolveAutonomousWorkTools,
} from "@/lib/tak/autonomous-work-run";
import { createTaskMessage } from "@/lib/tak/task-records";

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
};

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
  taskRunId: string;
  status: string;
  progressPayload: unknown;
  a2aMetadata: unknown;
};

function replayOrConflict(existing: ExistingRemoteTask, requestDigest: string): RemoteTaskSubmitOutcome {
  const metadata = existing.a2aMetadata && typeof existing.a2aMetadata === "object"
    ? existing.a2aMetadata as Record<string, unknown>
    : {};
  const storedDigest = optionalString(metadata["requestDigest"]);
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
  return {
    kind: "result",
    result: {
      taskRunId: existing.taskRunId,
      status: existing.status,
      idempotentReplay: true,
      requiresApproval: existing.status === "input-required",
      progressPayload: existing.progressPayload,
      a2aMetadata: existing.a2aMetadata,
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
  });
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
      taskRunId: true,
      status: true,
      progressPayload: true,
      a2aMetadata: true,
    },
  };
  const existing = await prisma.taskRun.findFirst(existingQuery);

  if (existing) {
    return replayOrConflict(existing, requestDigest);
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
        requestedThreadId: parsed.threadId ?? null,
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

  const agent = await resolveAutonomousWorkAgent({
    agentId: parsed.agentId,
    routeContext: parsed.routeContext,
    userContext,
  });
  const resolvedAgentId = agent.agentId ?? parsed.agentId;
  const toolMode = parsed.riskClass === "read" ? "advise" : "act";
  const tools = await resolveAutonomousWorkTools({
    userContext,
    agentId: resolvedAgentId,
    mode: toolMode,
    externalAccessEnabled: true,
    // BI-CAP-F2D39F8F: budget the attachment to the serving model; the remote
    // task prompt ranks which tools stay attached.
    routeContext: parsed.routeContext,
    intentQuery: parsed.prompt,
  });

  try {
    const result = await executeAutonomousAgenticLoop({
      systemPrompt: agent.systemPrompt,
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
        idempotentReplay: false,
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
        idempotentReplay: false,
        requiresApproval: false,
        content: remoteTaskContent(message),
        isError: true,
      },
    };
  }
}

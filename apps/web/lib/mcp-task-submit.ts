import { prisma } from "@dpf/db";
import { createAutonomousWorkRun } from "@/lib/tak/autonomous-work-run";
import { createTaskMessage } from "@/lib/tak/task-records";
import { enqueueRemoteTaskExecution } from "@/lib/queue/mcp-task-dispatch";

export const REMOTE_RISK_CLASSES = ["read", "bounded-write", "high-risk"] as const;
export type RemoteRiskClass = (typeof REMOTE_RISK_CLASSES)[number];
const REMOTE_TASK_ACCEPTED_STATUS = "working" as const;

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
};

export type RemoteTaskSubmitAuth = {
  tokenId: string;
  userId: string;
  agentId?: string | null;
  scopes: string[];
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
  };
}

export async function submitRemoteCoworkerTask(input: {
  token: RemoteTaskSubmitAuth;
  params: Record<string, unknown> | undefined;
}): Promise<RemoteTaskSubmitOutcome> {
  const parsed = parseRemoteTaskSubmitParams(input.params);
  if (typeof parsed === "string") {
    return { kind: "invalid_params", message: parsed };
  }

  const { token } = input;
  if (token.source !== "pat") {
    return {
      kind: "result",
      result: {
        content: remoteTaskContent(
          "Asynchronous remote tasks require a durable MCP personal access token so the worker can reauthorize after the request ends.",
        ),
        structuredContent: {
          error: "durable_authorization_required",
          action: "Use a scoped dpfmcp_ personal access token for asynchronous task submission.",
        },
        isError: true,
      },
    };
  }
  if (token.agentId && token.agentId !== parsed.agentId) {
    return {
      kind: "result",
      result: {
        content: remoteTaskContent("This token is bound to a different coworker identity."),
        structuredContent: {
          error: "agent_binding_mismatch",
          tokenAgentId: token.agentId,
          requestedAgentId: parsed.agentId,
        },
        isError: true,
      },
    };
  }
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

  const existing = await prisma.taskRun.findFirst({
    where: {
      userId: token.userId,
      mcpOwnerTokenId: token.tokenId,
      a2aMetadata: {
        path: ["idempotencyKey"],
        equals: parsed.idempotencyKey,
      },
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      taskRunId: true,
      status: true,
      progressPayload: true,
      a2aMetadata: true,
    },
  });

  if (existing) {
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

  const contextKey = parsed.threadId ?? `mcp:${token.tokenId}:${parsed.idempotencyKey}`;
  const thread = await prisma.agentThread.upsert({
    where: { userId_contextKey: { userId: token.userId, contextKey } },
    update: {},
    create: { userId: token.userId, contextKey },
    select: { id: true },
  });

  const sourceKind = "mcp-token";
  const run = await createAutonomousWorkRun({
    trigger: "external-mcp",
    userId: token.userId,
    agentId: parsed.agentId,
    routeContext: parsed.routeContext,
    title: parsed.title,
    objective: parsed.objective,
    prompt: parsed.prompt,
    threadId: thread.id,
    // The server-resolved PAT grants are the durable authority record. A
    // caller-provided authorityScope is descriptive input only and must never
    // widen what the token can do.
    authorityScope: token.scopes,
    sourceRef: { kind: sourceKind, id: token.tokenId },
    metadata: {
      idempotencyKey: parsed.idempotencyKey,
      riskClass: parsed.riskClass,
      apiTokenId: token.tokenId,
      tokenSource: token.source,
      requestedAuthorityScope: parsed.authorityScope ?? null,
      requestedThreadId: parsed.threadId ?? null,
    },
  });

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
        mcpOwnerTokenId: token.tokenId,
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
  await prisma.taskRun.update({
    where: { taskRunId: run.taskRunId },
    data: { mcpOwnerTokenId: token.tokenId },
  });
  await enqueueRemoteTaskExecution(run.taskRunId);
  return {
    kind: "result",
    result: {
      taskRunId: run.taskRunId,
      status: REMOTE_TASK_ACCEPTED_STATUS,
      idempotentReplay: false,
      requiresApproval: false,
      content: remoteTaskContent("Remote task accepted for asynchronous execution."),
      isError: false,
    },
  };
}

import { submitRemoteCoworkerTask } from "@/lib/mcp-task-submit";
import {
  MCP_MISSING_REQUIRED_CLIENT_CAPABILITY,
  MCP_TASKS_EXTENSION,
  handleTasksCancel,
  handleTasksGet,
  handleTasksList,
  handleTasksResult,
  handleTasksUpdate,
  tasksExtensionNegotiated,
  tasksLifecycleEnabled,
  type TaskLifecycleResult,
} from "./tasks-lifecycle";

export type McpTaskRouteAuth = {
  tokenId: string;
  userId: string;
  agentId?: string | null;
  scopes: string[];
  capability: "read" | "write";
  source: "pat" | "session-jwt";
};

export type McpTaskRouteOutcome =
  | { kind: "ok"; value: Record<string, unknown> }
  | { kind: "error"; code: number; message: string; data?: unknown; httpStatus?: number };

export async function submitMcpTask(
  token: McpTaskRouteAuth,
  params: Record<string, unknown> | undefined,
): Promise<McpTaskRouteOutcome> {
  const outcome = await submitRemoteCoworkerTask({ token, params });
  return outcome.kind === "invalid_params"
    ? { kind: "error", code: -32602, message: outcome.message }
    : { kind: "ok", value: outcome.result };
}

export async function dispatchMcpTaskLifecycle(input: {
  method: string;
  token: McpTaskRouteAuth;
  params: Record<string, unknown> | undefined;
  modern: boolean;
  clientCapabilities: Record<string, unknown>;
}): Promise<McpTaskRouteOutcome> {
  if (!tasksLifecycleEnabled()) {
    return { kind: "error", code: -32601, message: `unknown method: ${input.method}` };
  }
  const official = input.method === "tasks/get" || input.method === "tasks/update" || input.method === "tasks/cancel";
  if (input.modern && official && !tasksExtensionNegotiated(input.clientCapabilities)) {
    return {
      kind: "error",
      code: MCP_MISSING_REQUIRED_CLIENT_CAPABILITY,
      message: "Missing required client capability",
      data: { requiredCapabilities: { extensions: { [MCP_TASKS_EXTENSION]: {} } } },
      httpStatus: 400,
    };
  }

  const auth = { userId: input.token.userId, tokenId: input.token.tokenId, agentId: input.token.agentId };
  let result: TaskLifecycleResult;
  switch (input.method) {
    case "tasks/get": result = await handleTasksGet(auth, input.params); break;
    case "tasks/update": result = await handleTasksUpdate(auth, input.params); break;
    case "tasks/result": result = await handleTasksResult(input.token.userId, input.params, input.token.tokenId); break;
    case "tasks/list": result = await handleTasksList(input.token.userId, input.params); break;
    case "tasks/cancel": result = await handleTasksCancel(auth, input.params); break;
    default: return { kind: "error", code: -32601, message: `unknown method: ${input.method}` };
  }
  return result.kind === "ok"
    ? { kind: "ok", value: result.value }
    : { kind: "error", code: -32602, message: result.message };
}

// Work-thread tools share one pack and governing grant map. Child-thread
// handlers retain their existing delegation behavior. Exact-response feedback
// handlers use the shared transactional domain, with read/write grants distinct.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tool-types";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import { THREAD_TOOL_GRANTS } from "@/lib/tak/thread-tool-grants";
import { responseFeedbackDefinitions, responseFeedbackHandlers } from "./work-thread-feedback";

const definitions: ToolDefinition[] = [
  ...responseFeedbackDefinitions,
  {
    name: "spawn_work_thread",
    description: "Start a child coworker thread from the current thread. Use for delegated work that should report back separately.",
    inputSchema: {
      type: "object",
      properties: {
        objective: { type: "string", description: "The delegated work objective." },
        title: { type: "string", description: "Optional short title for the delegated work." },
      },
      required: ["objective"],
    },
    requiredCapability: null,
    sideEffect: true,
  },
  {
    name: "cancel_thread",
    description: "Cancel a coworker child thread. Defaults to the current thread when no threadId is supplied.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "Thread id to cancel. Defaults to the current thread." },
      },
    },
    requiredCapability: null,
    sideEffect: true,
    // destroys state → consult-gated (TAK §8.4.1).
    consequence: "irreversible",
  },
  {
    name: "get_thread_result",
    description: "Poll a coworker child thread until it completes and return its result.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "Child thread id to read." },
      },
      required: ["threadId"],
    },
    requiredCapability: null,
    sideEffect: false,
  },
  {
    name: "get_child_threads",
    description: "List child coworker threads for the current thread with their latest objective and status.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    requiredCapability: null,
    sideEffect: false,
  },
];

async function spawnWorkThreadHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string; threadId?: string; agentId?: string },
): Promise<ToolResult> {
  if (!context?.threadId) {
    const message = "Error: spawn_work_thread requires caller thread context";
    return {
      success: false,
      error: "missing_threadId",
      message,
    };
  }
  const { spawnWorkThread } = await import("@/lib/actions/agent-coworker");
  const result = await spawnWorkThread(
    {
      parentThreadId: context.threadId,
      objective: String(params["objective"] ?? ""),
      title: typeof params["title"] === "string" ? params["title"] : undefined,
      routeContext: context.routeContext,
      agentId: context.agentId,
    },
    userId,
  );
  return {
    success: true,
    entityId: result.child.id,
    message: "Started child thread.",
    data: { child: result.child, taskRunId: result.taskRunId },
  };
}

async function cancelThreadHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { threadId?: string },
): Promise<ToolResult> {
  const threadId = typeof params["threadId"] === "string" && params["threadId"].trim()
    ? params["threadId"].trim()
    : context?.threadId;
  if (!threadId) {
    return {
      success: false,
      error: "missing_threadId",
      message: "cancel_thread requires a threadId or current thread context.",
    };
  }
  const { cancelThread } = await import("@/lib/actions/agent-coworker");
  const result = await cancelThread({ threadId }, userId);
  return {
    success: true,
    entityId: threadId,
    message: "Cancelled thread.",
    data: result,
  };
}

async function getThreadResultHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const threadId = typeof params["threadId"] === "string" && params["threadId"].trim()
    ? params["threadId"].trim()
    : null;
  if (!threadId) {
    return {
      success: false,
      error: "missing_threadId",
      message: "get_thread_result requires a threadId.",
    };
  }
  const { getThreadResult } = await import("@/lib/actions/agent-coworker");
  const result = await getThreadResult({ childId: threadId }, userId);
  return {
    success: true,
    entityId: threadId,
    message: "Thread completed.",
    data: { result },
  };
}

async function getChildThreadsHandler(
  _params: Record<string, unknown>,
  userId: string,
  context?: { threadId?: string },
): Promise<ToolResult> {
  if (!context?.threadId) {
    return {
      success: false,
      error: "missing_threadId",
      message: "get_child_threads requires a current thread context.",
    };
  }
  const { getChildThreads } = await import("@/lib/actions/agent-coworker");
  const threads = await getChildThreads({ parentThreadId: context.threadId }, userId);
  return {
    success: true,
    message: `Found ${threads.length} child thread${threads.length === 1 ? "" : "s"}.`,
    data: { threads },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  ...responseFeedbackHandlers,
  spawn_work_thread: (params, userId, context) => spawnWorkThreadHandler(params, userId, context),
  cancel_thread: (params, userId, context) => cancelThreadHandler(params, userId, context),
  get_thread_result: (params, userId) => getThreadResultHandler(params, userId),
  get_child_threads: (params, userId, context) => getChildThreadsHandler(params, userId, context),
};

export const workThreadPack: ToolPack = {
  packId: "work-thread",
  definitions,
  handlers,
  grants: THREAD_TOOL_GRANTS,
};

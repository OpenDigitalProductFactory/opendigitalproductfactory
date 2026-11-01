import type { ToolDefinition, ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import type { ToolPackHandler } from "../tool-pack";

export const responseFeedbackDefinitions: ToolDefinition[] = [
  {
    name: "get_response_feedback", description: "Read the explicit disposition for an exact saved coworker response, including availability and human or coworker attribution. Answer text requires includeAnswer true and the exact expectedAttemptId selected for investigation.",
    inputSchema: { type: "object", properties: { messageId: { type: "string", description: "The saved assistant message id." }, includeAnswer: { type: "boolean", description: "Explicitly request the authorized exact saved answer; default false." }, expectedAttemptId: { type: "string", minLength: 1, description: "Required when includeAnswer is true: the exact attempt selected for investigation." } }, required: ["messageId"], additionalProperties: false },
    requiredCapability: null, sideEffect: false,
  },
  {
    name: "record_response_feedback", description: "Record your own coworker disposition for an exact saved response: true means kept, false needs revision, null clears your judgment. Human feedback is protected.",
    inputSchema: { type: "object", properties: { messageId: { type: "string" }, value: { type: ["boolean", "null"] }, expectedRevision: { type: "integer", minimum: 0 } }, required: ["messageId", "value", "expectedRevision"], additionalProperties: false },
    requiredCapability: null, sideEffect: true,
  },
];
function refused(error: string): ToolResult { return { success: false, error, message: error === "forbidden" ? "Response feedback access refused." : "Response feedback unavailable." }; }
function actor(userId: string, context?: ToolExecutionContext) {
  if (!userId || !context?.agentId?.trim() || !context.governedSource) return null;
  return { userId, agentId: context.agentId };
}
function writeAllowed(context: ToolExecutionContext) {
  if (context.tokenScope === "read") return false;
  if (context.tokenScope === undefined && context.governedSource !== "agentic-loop") return false;
  return context.tokenGrantScopes === undefined || context.tokenGrantScopes.includes("thread_write");
}
const get: ToolPackHandler = async (params, userId, context) => {
  const who = actor(userId, context); if (!who) return refused("forbidden");
  if (typeof params.messageId !== "string" || !params.messageId.trim()
    || (params.includeAnswer !== undefined && typeof params.includeAnswer !== "boolean")) return refused("unavailable");
  try {
    const { getResponseFeedback, getResponseFeedbackAnswer } = await import("@/lib/routing/response-feedback");
    if (params.includeAnswer === true) {
      if (typeof params.expectedAttemptId !== "string" || !params.expectedAttemptId.trim()) return refused("unavailable");
      const answer = await getResponseFeedbackAnswer(params.messageId, params.expectedAttemptId, who);
      return { success: true, message: answer ? "Authorized saved response loaded." : "Response feedback unavailable.", data: { answer } };
    }
    const state = await getResponseFeedback(params.messageId, who);
    return { success: true, message: state.available ? "Response feedback loaded." : "Response feedback unavailable.", data: { state } };
  } catch (error) { return refused(error instanceof Error && error.message === "forbidden" ? "forbidden" : "save-failed"); }
};
const record: ToolPackHandler = async (params, userId, context) => {
  const who = actor(userId, context); if (!who || !context || !writeAllowed(context)) return refused("forbidden");
  if (typeof params.messageId !== "string" || !params.messageId.trim()
    || (params.value !== null && typeof params.value !== "boolean")
    || typeof params.expectedRevision !== "number" || !Number.isSafeInteger(params.expectedRevision) || params.expectedRevision < 0) return refused("unavailable");
  const { recordResponseFeedback } = await import("@/lib/routing/response-feedback");
  const result = await recordResponseFeedback({ messageId: params.messageId, value: params.value, expectedRevision: params.expectedRevision }, { ...who, surface: "mcp" });
  return result.ok ? { success: true, message: result.changed ? "Response feedback saved." : "Response feedback unchanged.", data: { state: result.state, changed: result.changed } } : refused(result.error);
};
export const responseFeedbackHandlers: Record<string, ToolPackHandler> = { get_response_feedback: get, record_response_feedback: record };

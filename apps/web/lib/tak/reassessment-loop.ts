import type { TaskExecutionFence } from "../shared/task-execution-fence";
import type { ToolCallEntry } from "../routing/chat-message-types";
import { assertReassessmentActive, assertReassessmentPlan, assertReassessmentToolCall,
  isReassessmentExecutionError, refuseReassessmentExecution } from "../routing/reassessment-execution-scope";

type Identity = { userId: string; agentId: string; taskRunId?: string | null; taskExecutionFence?: TaskExecutionFence | null };
type ReassessmentLoopInput = Identity & { tools: readonly { name: string }[]; toolsForProvider?: readonly Record<string, unknown>[];
  deferredTools?: readonly unknown[]; enableExecutionPlan?: boolean; proposeSideEffects?: boolean };

/** A captured loop never becomes ordinary merely because a callback lost ALS. */
export function assertRestrictedReassessmentTurn(restricted: boolean, tools: readonly Record<string, unknown>[] | undefined): void {
  if (!restricted) return;
  const context = assertReassessmentActive();
  if (!context) refuseReassessmentExecution("reassessment-context-missing");
  assertReassessmentPlan({ providerId: context.qualification.providerId, modelId: context.qualification.modelId,
    plan: context.qualification.executionPlan, tools });
}

export function restrictedReassessmentLoop(input: ReassessmentLoopInput): boolean {
  const context = assertReassessmentActive();
  if (!context) return false;
  if (input.enableExecutionPlan || input.proposeSideEffects || input.deferredTools?.length
    || input.tools.length !== 2 || new Set(input.tools.map(tool => tool.name)).size !== 2
    || input.tools.some(tool => !["read_source_at_version", context.binding.writerToolName].includes(tool.name))) {
    refuseReassessmentExecution("reassessment-loop-composition-changed", "The restricted loop requires only its admitted reader and writer without auxiliary execution modes.");
  }
  assertReassessmentToolCall({ toolName: "read_source_at_version", params: {}, userId: input.userId, agentId: input.agentId,
    taskRunId: input.taskRunId ?? undefined, executionFence: input.taskExecutionFence });
  assertRestrictedReassessmentTurn(true, input.toolsForProvider);
  return true;
}

/** Validate before intrinsic/meta-tool interception as well as governed dispatch. */
export function restrictedReassessmentToolCall(restricted: boolean, input: Identity, call: ToolCallEntry): ToolCallEntry {
  if (!restricted) return call;
  if (!assertReassessmentActive()) refuseReassessmentExecution("reassessment-context-missing");
  return { ...call, arguments: assertReassessmentToolCall({ toolName: call.name, params: call.arguments,
    userId: input.userId, agentId: input.agentId, taskRunId: input.taskRunId ?? undefined, executionFence: input.taskExecutionFence }) };
}

/** The executor reconciles committed receipts before classifying capture holds. */
export function rethrowRestrictedReassessmentError(restricted: boolean, error: unknown): void {
  if (restricted && isReassessmentExecutionError(error)) throw error;
}

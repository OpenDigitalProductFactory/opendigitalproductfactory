import type { ToolResult } from "@/lib/mcp-tool-types";
import type { EvidenceRecoveryDiagnostics } from "./evidence-recovery-artifact";
import type { ExecutionPlan } from "./execution-plan";
import type { InferenceDeadEndOutcome } from "./inference-dead-ends";
import { preserveResponseProducer, type ResponseProducer } from "../routing/response-producer";
export type ExecutedTool = { name: string; args?: Record<string, unknown>; result: ToolResult; modelEvidenceTruncated?: boolean };
export type AgenticResult = EvidenceRecoveryDiagnostics & {
  /** Final text response from the agent */
  content: string;
  responseProducer?: ResponseProducer;
  suppliedSourceEvidence?: boolean;
  /** Provider that generated the final response */
  providerId: string;
  modelId: string;
  /** Whether the provider was downgraded */
  downgraded: boolean;
  downgradeMessage: string | null;
  /** Total tokens across all iterations */
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Tool calls executed during the loop */
  executedTools: ExecutedTool[];
  /** If a proposal tool was called, return it for approval card rendering */
  proposal: { name: string; arguments: Record<string, unknown>; content: string } | null;
  /** Chat only (BI-7BCC87BB): the approval requests a declared-proposal call raised; the turn ended on them. */
  pendingApproval?: { envelopeIds: string[] };
  failure?: InferenceDeadEndOutcome;
  /**
   * BI-2AC48661: the execution plan as it stood when the loop returned, when
   * `enableExecutionPlan` was set. Null when planning was off or the model
   * never recorded one. Carried out for observability and for the streamed-plan
   * UX (BI-95C0835E).
   */
  executionPlan?: ExecutionPlan | null;
};
export type AgenticCompletionSource = {
  providerId: string;
  modelId: string;
  downgraded: boolean;
  downgradeMessage: string | null;
  responseProducer?: ResponseProducer;
};
export type AgenticCompletionExtra = Partial<Pick<AgenticResult,
  "failure" | "executionPlan" | "withheldContent" | "evidenceFailure">> & { synthetic?: boolean };

/** Return final text with the producer of that text, never the most recent call. */
export function completeAgenticResult(
  content: string,
  source: AgenticCompletionSource | null,
  context: Pick<AgenticResult, "totalInputTokens" | "totalOutputTokens" | "executedTools" | "suppliedSourceEvidence">,
  extra: AgenticCompletionExtra = {},
): AgenticResult {
  const { synthetic, ...resultExtra } = extra;
  return {
    content,
    providerId: source?.providerId ?? "",
    modelId: source?.modelId ?? "",
    downgraded: source?.downgraded ?? false,
    downgradeMessage: source?.downgradeMessage ?? null,
    ...context,
    proposal: null,
    suppliedSourceEvidence: context.suppliedSourceEvidence && !extra.failure,
    responseProducer: !synthetic && !extra.failure && source
      ? preserveResponseProducer(source.responseProducer, content, source)
      : undefined,
    ...resultExtra,
  };
}

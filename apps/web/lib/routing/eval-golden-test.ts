import { callProvider, InferenceError } from "@/lib/ai-inference";
import type { GoldenTest, ScoringMethod } from "./golden-tests";
import { scoreExact, scorePartial, scoreSchema, scoreToolCall, scoreStructural, scoreRetrieval } from "./eval-scoring";
import { resolveDefaultExecutionAdapter } from "./execution-plan";
import { createRoutingTraceId } from "./routing-trace";
export interface TestResult {
  testId: string;
  version: number;
  scoring: ScoringMethod;
  score: number | null; // 0-10 when measured; null for an incomplete observation
  response: string;
  error?: string;
  traceId?: string;
  truncated?: boolean; // absent historical/legacy evidence stays unknown
}

/** Score a single response using the appropriate scoring method. */
function scoreResponse(
  test: GoldenTest,
  content: string,
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
): number | null {
  switch (test.scoring) {
    case "exact":
      return scoreExact(content, test.expectedOutput ?? "");
    case "partial":
      return scorePartial(content, test.expectedOutput ?? "");
    case "schema":
      return scoreSchema(content, test.expectedSchema ?? {});
    case "tool_call":
      return scoreToolCall(toolCalls, test.expectedOutput ?? "");
    case "structural":
      return scoreStructural(content, test.expectedOutput ?? "");
    case "retrieval":
      return scoreRetrieval(content, test.expectedOutput ?? "");
    case "orchestrator":
      return null;
    default:
      return null;
  }
}

/** Run a single golden test against an endpoint, with one rate-limit retry. */
export async function runGoldenTest(
  endpointId: string,
  modelId: string,
  test: GoldenTest,
  opts: { dispatch?: typeof callProvider; requireComplete?: boolean } = {},
): Promise<TestResult> {
  // No grader means no observation to score and no reason to spend inference.
  if (test.scoring === "orchestrator") {
    return { testId: test.id, version: test.version, scoring: test.scoring,
      score: null, response: "", error: "No grader is configured; quality is unverified." };
  }
  const traceId = createRoutingTraceId();
  const attempt = async (): Promise<TestResult> => {
    const messages = [{ role: "user" as const, content: test.prompt }];
    const result = await (opts.dispatch ?? callProvider)(
      endpointId,
      modelId,
      messages,
      test.systemPrompt ?? "You are a helpful assistant.",
      test.tools,
      {
        providerId: endpointId,
        modelId,
        recipeId: null,
        contractFamily: "model-calibration.dimension",
        executionAdapter: resolveDefaultExecutionAdapter(endpointId),
        maxTokens: test.maxTokens ?? 512,
        providerSettings: {},
        toolPolicy: test.tools?.length ? { toolChoice: "auto" } : {},
        responsePolicy: {},
      },
      undefined,
      undefined,
      { traceId },
    );
    if (result.truncated === true || opts.requireComplete && result.finishReason !== "completed") {
      return { testId: test.id, version: test.version, scoring: test.scoring,
        score: null, response: result.content.slice(0, 500), traceId,
        ...(result.truncated === undefined ? {} : { truncated: result.truncated }),
        error: "Golden test output was truncated or completion is unverified; quality is unverified." };
    }
    const score = scoreResponse(test, result.content, result.toolCalls ?? []);
    return {
      testId: test.id,
      version: test.version,
      scoring: test.scoring,
      score,
      ...(score === null ? { error: "No implemented grader; quality is unverified." } : {}),
      response: result.content.slice(0, 500),
      traceId,
      ...(result.truncated === undefined ? {} : { truncated: result.truncated }),
    };
  };

  try {
    return await attempt();
  } catch (e) {
    // Single retry for rate limits — wait 10 s then try once more
    if (e instanceof InferenceError && e.code === "rate_limit") {
      console.warn(`[eval-runner] rate limited on ${endpointId}/${modelId} (test ${test.id}), retrying in 10 s`);
      await new Promise((r) => setTimeout(r, 10_000));
      try {
        return await attempt();
      } catch (e2) {
        const msg = e2 instanceof Error ? e2.message : String(e2);
        console.error(`[eval-runner] test ${test.id} failed after retry on ${endpointId}/${modelId}: ${msg}`);
        return { testId: test.id, version: test.version, scoring: test.scoring, score: opts.requireComplete ? null : 0, response: "", error: msg || "unknown error", traceId };
      }
    }

    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error(`[eval-runner] test ${test.id} failed on ${endpointId}/${modelId} (model: ${modelId}): ${errorMessage}`);
    return {
      testId: test.id,
      version: test.version,
      scoring: test.scoring,
      score: opts.requireComplete ? null : 0,
      response: "",
      error: errorMessage || "unknown error",
      traceId,
    };
  }
}

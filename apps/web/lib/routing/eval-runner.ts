/**
 * EP-INF-001-P6: Eval runner — orchestrates golden test evaluation,
 * computes dimension scores, detects drift, updates ModelProvider profiles.
 */
import { prisma } from "@dpf/db";
import * as crypto from "crypto";
import { callProvider, InferenceError } from "@/lib/ai-inference";
import { providerHasConfiguredCredential } from "@/lib/inference/ai-provider-internals";
import type { BuiltinDimension } from "./types";
import { BUILTIN_DIMENSIONS } from "./types";
import { getTestsForDimension, type GoldenTest, type ScoringMethod } from "./golden-tests";
import {
  scoreExact,
  scorePartial,
  scoreSchema,
  scoreToolCall,
  scoreStructural,
  scoreRetrieval,
  scoreDimension,
} from "./eval-scoring";
import { BACKGROUND_EVAL_ENDPOINT_TYPES, MODEL_ROUTING_ENDPOINT_TYPES } from "./provider-eligibility";

// ── Infrastructure Error Classifier (BI-INST-008 circuit breaker) ──────────
//
// Patterns that indicate the probe path itself was broken, not the model
// being probed. When an all-inconclusive eval matches one of these
// patterns we skip the auto-retire so the operator can fix the
// infrastructure and the next eval can give the model a fair chance.
const INFRASTRUCTURE_ERROR_PATTERNS: RegExp[] = [
  /No eligible endpoints/i,
  /No active endpoint manifests/i,
  /operation was aborted due to timeout/i,
  /network error/i,
  /fetch failed/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /socket hang up/i,
  /Docker Model Runner is not running/i,
  /could not resolve host/i,
  // Capacity/admission timeouts describe a BUSY engine, not a broken model.
  // A local engine holding a 20GB model can exceed the admission budget purely
  // from load or a cold weight-load, and the same model answers a direct
  // request seconds later. Retiring on this stranded the bundled model for five
  // weeks on a live install: "Auto-retired: inference admission timeout on
  // local engine after 120000ms" (BI-32426CA0). The existing
  // /operation was aborted due to timeout/ pattern did not match this wording.
  /admission timeout/i,
  /timed? ?out after \d+ms/i,
  /request timeout/i,
  /engine is busy/i,
  /capacity/i,
];

/**
 * Classify an eval error string as infrastructure vs model-quality.
 * Returns true if the error indicates a broken probe path (no route,
 * network failure, runner not started, etc.) — in which case the
 * auto-retire circuit breaker should NOT retire the model.
 *
 * Returns false for null/unknown errors so they fall through to the
 * existing retire-on-failure behaviour (preserves backward compat).
 */
export function errorLooksLikeInfrastructure(error: string | null): boolean {
  return error !== null && INFRASTRUCTURE_ERROR_PATTERNS.some((re) => re.test(error));
}

/**
 * Which sensitivity classes would lose their last routable endpoint if this
 * profile were retired.
 *
 * Mirrors the candidate query in `queryEndpointManifests`
 * (apps/web/lib/routing/loader.ts) exactly — modelStatus active|degraded,
 * retiredAt null, provider active|degraded, provider endpointType routable.
 * A transcription/embedding endpoint therefore never counts as cover, which
 * matters: on the install that motivated this, the only other provider holding
 * `restricted` clearance was a transcription endpoint that can never serve a
 * chat request.
 *
 * Pure-ish and exported so the guard is unit-testable without driving a full
 * eval run.
 */
export async function sensitivityClassesLeftUncoveredByRetiring(
  providerId: string,
  modelId: string,
): Promise<string[]> {
  const self = await prisma.modelProfile.findUnique({
    where: { providerId_modelId: { providerId, modelId } },
    select: { id: true, provider: { select: { sensitivityClearance: true } } },
  });
  const covered = self?.provider?.sensitivityClearance ?? [];
  if (covered.length === 0) return [];

  const peers = await prisma.modelProfile.findMany({
    where: {
      id: { not: self!.id },
      modelStatus: { in: ["active", "degraded"] },
      retiredAt: null,
      provider: {
        status: { in: ["active", "degraded"] },
        endpointType: { in: [...MODEL_ROUTING_ENDPOINT_TYPES] },
      },
    },
    select: { provider: { select: { sensitivityClearance: true } } },
  });

  const peerCover = new Set(peers.flatMap((p) => p.provider?.sensitivityClearance ?? []));
  return covered.filter((level) => !peerCover.has(level));
}

// ── Config-gap Error Classifier ────────────────────────────────────────────
//
// Credential / setup gaps: the provider is selectable but not actually usable
// (no API key, a key that no longer decrypts, OAuth never connected). Like
// infrastructure errors, these describe a FIXABLE setup problem, not a
// model-quality failure — so the auto-retire circuit breaker must NOT retire
// the model for them. Retiring on "No credential configured" was a real bug:
// the operator adds the key later and finds every model stranded as "retired".
// The eval scheduler also pre-filters these providers out entirely (see
// runAllDimensionEvals) so this classifier is the second line of defence.
const CONFIG_ERROR_PATTERNS: RegExp[] = [
  /No credential configured/i,
  /No credential for/i,
  /failed to decrypt/i,
  /re-configure this provider/i,
  /requires an API key/i,
  /not connected/i,
];

/**
 * Classify an eval error string as a provider config/credential gap.
 * Returns true for fixable setup problems (missing/rotated key, OAuth not
 * connected) — in which case the model must NOT be auto-retired. Returns false
 * for null/unknown errors so they fall through to existing behaviour.
 */
export function errorLooksLikeConfigGap(error: string | null): boolean {
  return error !== null && CONFIG_ERROR_PATTERNS.some((re) => re.test(error));
}

/**
 * Whole-endpoint failure: an error that will recur identically on EVERY test of
 * this endpoint because it describes the endpoint/setup, not the model output —
 * infrastructure (timeout / network / runner down) OR a config gap (missing or
 * rotated key, OAuth not connected). When the first probe matches, the eval
 * cycle short-circuits the remaining tests and dimensions: re-running them only
 * reproduces the same failure, burning wall-clock and flooding the logs.
 * Neither cause retires the model — both are fixable without touching it.
 */
export function errorEndsEvalCycle(error: string | null): boolean {
  return errorLooksLikeInfrastructure(error) || errorLooksLikeConfigGap(error);
}

// ── Score Computation ────────────────────────────────────────────────────────

/** Compute new dimension score from eval result and previous score. */
export function computeNewScore(
  evalScore: number,
  previousScore: number,
  evalCount: number,
): number {
  const raw = evalCount === 0
    ? evalScore
    : 0.7 * evalScore + 0.3 * previousScore;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

// ── Drift Detection ──────────────────────────────────────────────────────────

export type DriftResult = {
  severity: "none" | "warning" | "severe";
  delta: number;
};

/** Compare raw eval score against previous stored score. */
export function detectDrift(rawEvalScore: number, previousScore: number): DriftResult {
  const delta = previousScore - rawEvalScore;
  if (delta > 25) return { severity: "severe", delta };
  if (delta > 15) return { severity: "warning", delta };
  return { severity: "none", delta };
}

// ── Test Execution ───────────────────────────────────────────────────────────

interface TestResult {
  testId: string;
  version: number;
  scoring: ScoringMethod;
  score: number;       // 0-10
  response: string;
  error?: string;
}

/** Score a single response using the appropriate scoring method. */
function scoreResponse(
  test: GoldenTest,
  content: string,
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
): number {
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
      // KNOWN GAP: Orchestrator scoring requires a separate grading call to a different
      // endpoint (to avoid self-evaluation). This is not implemented in Phase 6 — the
      // conversational dimension will score neutral (5/10 = 50/100) until orchestrator
      // grading is added. This is acceptable because:
      // 1. Conversational quality is the least routing-critical dimension
      // 2. Production observations will nudge the score over time
      // 3. The infrastructure for cross-endpoint grading needs the eval runner itself to be stable first
      return 5;
    default:
      return 0;
  }
}

/** Run a single golden test against an endpoint, with one rate-limit retry. */
async function runGoldenTest(
  endpointId: string,
  modelId: string,
  test: GoldenTest,
): Promise<TestResult> {
  const attempt = async (): Promise<TestResult> => {
    const messages = [{ role: "user" as const, content: test.prompt }];
    const result = await callProvider(
      endpointId,
      modelId,
      messages,
      test.systemPrompt ?? "You are a helpful assistant.",
      test.tools,
    );
    const score = scoreResponse(test, result.content, result.toolCalls ?? []);
    return {
      testId: test.id,
      version: test.version,
      scoring: test.scoring,
      score,
      response: result.content.slice(0, 500),
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
        return { testId: test.id, version: test.version, scoring: test.scoring, score: 0, response: "", error: msg || "unknown error" };
      }
    }

    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error(`[eval-runner] test ${test.id} failed on ${endpointId}/${modelId} (model: ${modelId}): ${errorMessage}`);
    return {
      testId: test.id,
      version: test.version,
      scoring: test.scoring,
      score: 0,
      response: "",
      error: errorMessage || "unknown error",
    };
  }
}

// ── Dimension Eval Orchestration ─────────────────────────────────────────────

interface DimensionEvalResult {
  dimension: BuiltinDimension;
  rawScore: number;         // 0-100 from this eval
  newScore: number;         // after rolling average
  previousScore: number;
  drift: DriftResult;
  testResults: TestResult[];
  inconclusive: boolean;    // >50% of tests failed to run
}

/**
 * Minimum measured toolFidelity for an endpoint to count as tool-capable.
 *
 * Calibrated against the local-model capability priors
 * (@dpf/db/local-model-capabilities): magistral — a reasoning model that
 * fabricates answers instead of emitting tool_calls — sits at 30 and is
 * explicitly `avoidFor: ["tool-use"]`, while the weakest genuinely
 * tool-calling tiers (mistral/llama) sit at 50 and the "unknown" prior at 40.
 * 35 therefore separates "fabricates" from "actually calls tools".
 */
export const TOOL_USE_MIN_FIDELITY = 35;

/**
 * Decide the `supportsToolUse` boolean an eval should persist — the "calibrate"
 * half of attempt-and-calibrate (BI-DFC30977). Pure + exported for unit tests.
 *
 * Why this exists: the routing gates read the `supportsToolUse` BOOLEAN, but the
 * eval previously only ever wrote the `toolFidelity` SCORE. So once the gates
 * began attempting `null` (unknown) endpoints, nothing could ever resolve that
 * unknown — an endpoint that cannot actually emit tool_calls would be selected
 * again on every turn. This closes the loop.
 *
 * Returns `undefined` to mean "write nothing" (leave the stored value alone):
 *   - `capabilityOverrides.toolUse` is set — an admin pin is authoritative in
 *     BOTH directions and a measurement must never clobber it.
 *   - the toolFidelity dimension was inconclusive (infrastructure/config
 *     failure, not a model verdict) — preserving the previous value is what
 *     stops a broken probe path from mass-demoting a healthy fleet.
 *
 * Writing in both directions is deliberate and does NOT reintroduce the
 * "sticky false" trap (BI-B6DEBFFE): an eval-owned value is re-measured by the
 * next eval, so a demotion is always recoverable — unlike the old discovery
 * `?? false` coercion, which had no path back.
 */
export function resolveEvaluatedToolUse(input: {
  toolFidelity: Pick<DimensionEvalResult, "newScore" | "inconclusive"> | undefined;
  capabilityOverrides: unknown;
}): boolean | undefined {
  const overrides = input.capabilityOverrides as Record<string, unknown> | null | undefined;
  if (overrides && typeof overrides === "object" && "toolUse" in overrides) {
    return undefined;
  }
  if (!input.toolFidelity || input.toolFidelity.inconclusive) {
    return undefined;
  }
  return input.toolFidelity.newScore >= TOOL_USE_MIN_FIDELITY;
}

/** Resolve the best modelId for a provider (same as fallback.ts). */
async function resolveModelId(providerId: string): Promise<string> {
  const profile = await prisma.modelProfile.findFirst({
    where: { providerId },
    orderBy: { generatedAt: "desc" },
    select: { modelId: true },
  });
  if (profile) return profile.modelId;

  const discovered = await prisma.discoveredModel.findFirst({
    where: { providerId, NOT: { modelId: { contains: "embed" } } },
    orderBy: { modelId: "asc" },
    select: { modelId: true },
  });
  return discovered?.modelId ?? "";
}

/** Run golden test evaluation for one dimension on one endpoint. */
async function evalDimension(
  endpointId: string,
  modelId: string,
  dimension: BuiltinDimension,
  previousScore: number,
  evalCount: number,
): Promise<DimensionEvalResult> {
  const tests = getTestsForDimension(dimension);
  const testResults: TestResult[] = [];

  let endpointAborted = false;
  for (let i = 0; i < tests.length; i++) {
    if (i > 0) {
      // 500 ms between tests to avoid triggering burst rate limits
      await new Promise((r) => setTimeout(r, 500));
    }
    const result = await runGoldenTest(endpointId, modelId, tests[i]!);
    testResults.push(result);

    // Whole-endpoint short-circuit: once a probe fails for an endpoint/setup
    // reason — infrastructure (timeout, network, runner down) OR a config gap
    // (missing/rotated key) — every remaining test in this dimension fails
    // identically. Each can burn up to 60s plus a log line. Stop now; the
    // dimension is inconclusive regardless. Turns ~30 duplicate error lines
    // (and minutes of wasted wall-clock) into one.
    if (errorEndsEvalCycle(result.error ?? null)) {
      console.warn(
        `[eval-runner] ${endpointId}/${modelId}: endpoint/setup error on ${dimension} — skipping remaining tests this cycle: ${result.error}`,
      );
      endpointAborted = true;
      break;
    }
  }

  // Inconclusive when we aborted early on an endpoint/setup failure, or when
  // >50% of the tests that ran errored. Either way scores are preserved.
  const errorCount = testResults.filter((r) => r.error).length;
  const inconclusive = endpointAborted || errorCount > tests.length / 2;

  if (inconclusive) {
    return {
      dimension,
      rawScore: previousScore,
      newScore: previousScore,
      previousScore,
      drift: { severity: "none", delta: 0 },
      testResults,
      inconclusive: true,
    };
  }

  const rawScore = scoreDimension(testResults.map((r) => r.score));
  const drift = detectDrift(rawScore, previousScore);
  const newScore = computeNewScore(rawScore, previousScore, evalCount);

  return {
    dimension,
    rawScore,
    newScore,
    previousScore,
    drift,
    testResults,
    inconclusive: false,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface EvalRunResult {
  endpointId: string;
  modelId: string;
  dimensions: DimensionEvalResult[];
  testRunId: string;
  hasDrift: boolean;
  hasSevereDrift: boolean;
  /** First error message encountered across all tests, if any. Null when all tests succeeded. */
  firstError: string | null;
  /** True when the eval was short-circuited because another run was already in
   *  flight for (endpointId, modelId). Callers (e.g. eval-background.ts) should
   *  not stamp ScheduledJob as completed on a skipped result. */
  skipped?: true;
}

/** Maximum age of an in-flight EndpointTestRun before it is reaped as failed
 *  and a new eval is allowed to start. Tuned to be longer than a healthy full
 *  dimension eval (~90s for the bundled local model with 7 dimensions × ~10
 *  tests × <1s each) but short enough that an Inngest function timeout doesn't
 *  pin the model out of evals for hours. BI-C8164664. */
const EVAL_INFLIGHT_GUARD_MS = 10 * 60 * 1000;

/** How recently a model must have been evaluated to skip an automated re-eval.
 *  The in-flight guard above stops PARALLEL pile-up, but it only spans 10min —
 *  Inngest retries (the upstream `missing envID` lease bug re-queues each event
 *  up to maxAtts) land spaced further apart and would otherwise re-run the full
 *  golden-test corpus against an already-calibrated model indefinitely (~15%
 *  GPU duty cycle observed on the bundled local runner with evalCount=25). A
 *  recency cooldown makes those retries no-ops at the GPU level while leaving
 *  the daily model-discovery refresh and operator-forced re-evals unaffected.
 *  Override with DPF_EVAL_COOLDOWN_MS. BI-C8164664. */
const EVAL_RECENCY_COOLDOWN_MS = (() => {
  const raw = Number(process.env.DPF_EVAL_COOLDOWN_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 6 * 60 * 60 * 1000;
})();

/**
 * Run a full dimension evaluation for one endpoint/model pair.
 * Updates ModelProfile capability scores and creates an EndpointTestRun record.
 *
 * @param opts.force bypass the recency-cooldown guard (operator-initiated runs).
 */
export async function runDimensionEval(
  providerId: string,
  modelId: string,
  triggeredBy: string,
  opts: { force?: boolean } = {},
): Promise<EvalRunResult> {
  const modelProfile = await prisma.modelProfile.findUnique({
    where: { providerId_modelId: { providerId, modelId } },
  });

  if (!modelProfile) throw new Error(`ModelProfile ${providerId}/${modelId} not found`);

  // Don't eval retired or disabled models — they can't be called
  if (modelProfile.modelStatus === "retired" || modelProfile.modelStatus === "disabled") {
    throw new Error(`Model ${providerId}/${modelId} is ${modelProfile.modelStatus} — cannot run evaluation`);
  }

  // Don't eval providers that use user-delegated OAuth — those tokens are tied to a live
  // browser session and are not available in background eval workers. Attempting to call
  // them returns an HTML redirect page (401/403) rather than inference output.
  const provider = await prisma.modelProvider.findUnique({
    where: { providerId },
    select: { authMethod: true, name: true },
  });
  if (provider?.authMethod === "oauth2_authorization_code") {
    throw new Error(
      `${provider.name ?? providerId} uses user-delegated OAuth — evals require an API key or service credentials. ` +
      `Connect via a direct API key provider instead.`,
    );
  }

  // BI-C8164664: recency cooldown. A model that was evaluated within the
  // cooldown window does not need re-evaluating on an automated path — and
  // without this guard, Inngest's lease-failure retries re-run the full golden
  // suite every cooldown-cycle even though scores barely move once calibrated.
  // Operator-forced runs (opts.force) and never-evaluated models bypass it.
  if (
    !opts.force &&
    EVAL_RECENCY_COOLDOWN_MS > 0 &&
    modelProfile.lastEvalAt &&
    Date.now() - modelProfile.lastEvalAt.getTime() < EVAL_RECENCY_COOLDOWN_MS
  ) {
    console.log(
      `[eval-runner] Skipping ${providerId}/${modelId}: evaluated ${modelProfile.lastEvalAt.toISOString()} (within ${EVAL_RECENCY_COOLDOWN_MS / 60_000}min cooldown)`,
    );
    return {
      endpointId: providerId,
      modelId,
      dimensions: [],
      testRunId: "",
      hasDrift: false,
      hasSevereDrift: false,
      firstError: `Skipped: evaluated within cooldown (last ${modelProfile.lastEvalAt.toISOString()})`,
      skipped: true,
    };
  }

  // BI-C8164664: in-flight + recency guard. Without this, Inngest retries (or
  // any rapid-fire enqueue path — first-boot, page-load checkBundledProviders,
  // model-discovery refresh) can stack dozens of parallel dimension evals
  // against the same model. Each eval fires the full golden-test corpus, which
  // on a local Apple Silicon model runner pins the Metal GPU at 76+ t/s
  // continuously and creates EndpointTestRun(status="running") rows that may
  // never complete if the step is cut off mid-eval. Snapshot from the live
  // investigation: 184 stuck "running" rows in 24h, 0 completions, qwen3.6
  // serving 364k tasks — pure capability-eval traffic.
  const guardCutoff = new Date(Date.now() - EVAL_INFLIGHT_GUARD_MS);
  const inflightRecent = await prisma.endpointTestRun.findFirst({
    where: {
      endpointId: providerId,
      modelId,
      taskType: "dimension-eval",
      status: "running",
      startedAt: { gt: guardCutoff },
    },
    select: { runId: true, startedAt: true },
    orderBy: { startedAt: "desc" },
  });
  if (inflightRecent) {
    console.log(
      `[eval-runner] Skipping ${providerId}/${modelId}: run ${inflightRecent.runId} already in flight (started ${inflightRecent.startedAt.toISOString()})`,
    );
    return {
      endpointId: providerId,
      modelId,
      dimensions: [],
      testRunId: inflightRecent.runId,
      hasDrift: false,
      hasSevereDrift: false,
      firstError: `Skipped: run ${inflightRecent.runId} already in flight`,
      skipped: true,
    };
  }

  // Reap stale "running" rows older than the guard window so they don't pile
  // up forever. The most common cause is an Inngest step timeout that cuts the
  // function off after callProvider() has fired but before the terminal
  // endpointTestRun.update() runs. Treat these as failed so operators can see
  // them in the test-run history rather than silently disappearing.
  const reaped = await prisma.endpointTestRun.updateMany({
    where: {
      endpointId: providerId,
      modelId,
      taskType: "dimension-eval",
      status: "running",
      startedAt: { lte: guardCutoff },
    },
    data: {
      status: "failed",
      completedAt: new Date(),
    },
  });
  if (reaped.count > 0) {
    console.warn(
      `[eval-runner] Reaped ${reaped.count} stale "running" eval run(s) for ${providerId}/${modelId} older than ${EVAL_INFLIGHT_GUARD_MS / 60_000}min`,
    );
  }

  const currentEvalCount = modelProfile.evalCount;
  const runId = `DE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  // Create the test run record
  await prisma.endpointTestRun.create({
    data: {
      runId,
      endpointId: providerId,
      modelId,
      taskType: "dimension-eval",
      triggeredBy,
      status: "running",
    },
  });

  // Evaluate each dimension
  // Map BUILTIN_DIMENSIONS names to ModelProfile DB field names
  const dimToDbField: Record<string, string> = {
    instructionFollowing: "instructionFollowingScore",
    structuredOutput: "structuredOutputScore",
  };
  const dimensions: DimensionEvalResult[] = [];
  for (const dim of BUILTIN_DIMENSIONS) {
    const dbField = dimToDbField[dim] ?? dim;
    const previousScore = (modelProfile as Record<string, unknown>)[dbField] as number ?? 50;
    const result = await evalDimension(providerId, modelId, dim, previousScore, currentEvalCount);
    dimensions.push(result);

    // Per-model short-circuit: if this dimension was abandoned for an
    // endpoint/setup reason (infrastructure OR config gap — e.g. a rotated key
    // that passed the existence pre-filter but fails at call time), the
    // remaining dimensions fail identically. Stop rather than burn another ~7
    // dimensions × up-to-60s timeouts. Skipped dimensions keep their previous
    // scores (they were never re-scored), and the all-inconclusive verdict below
    // still correctly avoids retiring the model.
    const endpointUnusable =
      result.inconclusive &&
      result.testResults.some((t) => errorEndsEvalCycle(t.error ?? null));
    if (endpointUnusable) {
      console.warn(
        `[eval-runner] ${providerId}/${modelId}: endpoint unusable this cycle — skipping remaining dimensions`,
      );
      break;
    }
  }

  // Update ModelProfile with new scores (skip inconclusive dimensions)
  // Map dimension names to DB field names for the two that differ
  const scoreUpdates: Record<string, number> = {};
  for (const d of dimensions) {
    if (!d.inconclusive) {
      const dbField = dimToDbField[d.dimension] ?? d.dimension;
      scoreUpdates[dbField] = d.newScore;
    }
  }

  const hasDrift = dimensions.some((d) => d.drift.severity !== "none");
  const hasSevereDrift = dimensions.some((d) => d.drift.severity === "severe");

  // Only promote profileSource to "evaluated" when real scores were written.
  // An all-inconclusive eval preserves the previous scores unchanged — promoting
  // profileSource would lock the seed out from correcting stale catalog values.
  const allInconclusive = dimensions.every((d) => d.inconclusive);
  const hasRealScores = Object.keys(scoreUpdates).length > 0;

  // Calibrate half of attempt-and-calibrate (BI-DFC30977): the routing gates read
  // the supportsToolUse BOOLEAN, so a measured toolFidelity must be projected onto
  // it — otherwise an endpoint attempted as `null` (unknown) could never resolve.
  // capabilities.toolUse is written in lockstep so the two representations can
  // never disagree (the original defect surfaced as capabilities.toolUse=false on
  // a row with toolFidelity=100).
  const evaluatedToolUse = resolveEvaluatedToolUse({
    toolFidelity: dimensions.find((d) => d.dimension === "toolFidelity"),
    capabilityOverrides: modelProfile.capabilityOverrides,
  });
  const toolUseUpdate =
    evaluatedToolUse === undefined
      ? {}
      : {
          supportsToolUse: evaluatedToolUse,
          capabilities: {
            ...((modelProfile.capabilities as Record<string, unknown> | null) ?? {}),
            toolUse: evaluatedToolUse,
          },
        };

  await prisma.modelProfile.update({
    where: { providerId_modelId: { providerId, modelId } },
    data: {
      ...scoreUpdates,
      ...toolUseUpdate,
      ...(hasRealScores ? { profileSource: "evaluated" as const } : {}),
      profileConfidence: (currentEvalCount + 1) >= 5 ? "high" : "medium",
      evalCount: { increment: 1 },
      lastEvalAt: new Date(),
      ...(hasSevereDrift ? { modelStatus: "degraded" } : {}),
    },
  });

  // Complete the test run record
  await prisma.endpointTestRun.update({
    where: { runId },
    data: {
      status: "completed",
      completedAt: new Date(),
      avgScore: dimensions.reduce((a, d) => a + d.rawScore, 0) / dimensions.length,
      results: {
        dimensions: dimensions.map((d) => ({
          dimension: d.dimension,
          rawScore: d.rawScore,
          newScore: d.newScore,
          previousScore: d.previousScore,
          drift: d.drift,
          inconclusive: d.inconclusive,
          tests: d.testResults,
        })),
      } as any,
    },
  });

  // Collect first error for top-level surfacing (avoids deep-nesting serialization issues)
  const firstError = dimensions
    .flatMap((d) => d.testResults)
    .find((t) => t.error)?.error ?? null;

  // If ALL dimensions are inconclusive, the model MIGHT be unusable.
  // This covers: model removed (404), deprecated, wrong API type (400),
  // auth restrictions, and any other consistent failure pattern.
  //
  // BI-INST-008 circuit breaker: do NOT retire on infrastructure errors
  // (no route, network timeout, connection refused, etc.). Those errors
  // describe a broken probe path, not a broken model. The 2026-05-23
  // cold-install dogfood hit this: every probe failed with
  // "No eligible endpoints for task 'conversation'" (a routing bug in
  // the probe runner — now fixed by BI-INST-007), and the resulting
  // all-inconclusive verdict retired every local ModelProfile row,
  // leaving the platform with zero usable models. Recovery required
  // manual SQL un-retirement.
  //
  // errorLooksLikeInfrastructure is exported for unit testing — the
  // classifier is the only behavior change here that's worth a focused
  // test, and keeping it pure makes that test trivial.
  const looksLikeInfrastructure = errorLooksLikeInfrastructure(firstError);
  const looksLikeConfigGap = errorLooksLikeConfigGap(firstError);

  // Last line of defence, independent of what the error text looks like: never
  // auto-retire the last routable endpoint for a sensitivity class. Retiring is
  // load-bearing in a way the classifier above cannot see — routing filters
  // candidates on `retiredAt: null`, so a retirement does not merely downrank an
  // endpoint, it removes it. On an install where one provider is the sole holder
  // of a clearance (typically the bundled local model for `restricted`), that
  // silently leaves the class with zero eligible endpoints and every request in
  // it fails with the generic "No AI model can handle this request right now"
  // (BI-32426CA0). Degrade instead: the model keeps ranking last but stays
  // reachable, and the operator gets a warning naming the exposed class.
  const strandedClasses = allInconclusive && firstError
    ? await sensitivityClassesLeftUncoveredByRetiring(providerId, modelId)
    : [];

  if (
    allInconclusive && firstError && !looksLikeInfrastructure && !looksLikeConfigGap &&
    strandedClasses.length === 0
  ) {
    await prisma.modelProfile.update({
      where: { providerId_modelId: { providerId, modelId } },
      data: {
        modelStatus: "retired",
        retiredAt: new Date(),
        retiredReason: `Auto-retired: ${firstError.slice(0, 200)}`,
      },
    });
    console.log(`[eval-runner] Auto-retired ${providerId}/${modelId}: all tests failed — ${firstError.slice(0, 100)}`);
  } else if (allInconclusive && firstError && strandedClasses.length > 0) {
    await prisma.modelProfile.update({
      where: { providerId_modelId: { providerId, modelId } },
      data: { modelStatus: "degraded" },
    });
    console.warn(
      `[eval-runner] All dimensions inconclusive for ${providerId}/${modelId} but it is the LAST routable endpoint cleared for [${strandedClasses.join(", ")}] — degrading instead of retiring, so that sensitivity class keeps an eligible endpoint. Error: ${firstError.slice(0, 200)}`,
    );
  } else if (allInconclusive && (looksLikeInfrastructure || looksLikeConfigGap)) {
    console.warn(
      `[eval-runner] All dimensions inconclusive for ${providerId}/${modelId} but error looks like ${looksLikeConfigGap ? "a config gap" : "infrastructure"} — NOT retiring. Error: ${firstError?.slice(0, 200)}`,
    );
  }

  return {
    endpointId: providerId,
    modelId,
    dimensions,
    testRunId: runId,
    hasDrift,
    hasSevereDrift,
    firstError,
  };
}

/**
 * Run dimension evaluation for ALL active model profiles.
 */
export async function runAllDimensionEvals(triggeredBy: string): Promise<EvalRunResult[]> {
  const models = await prisma.modelProfile.findMany({
    where: {
      modelStatus: "active",
      retiredAt: null,
      provider: {
        status: { in: ["active", "degraded"] },
        endpointType: { in: [...BACKGROUND_EVAL_ENDPOINT_TYPES] },
        NOT: { authMethod: "oauth2_authorization_code" },
      },
    },
    select: {
      providerId: true,
      modelId: true,
      provider: { select: { authMethod: true } },
    },
  });

  // Pre-filter providers with no usable credential. Calling them is guaranteed
  // to fail with "No credential configured" — which floods the logs (one error
  // per golden test) and used to wrongly auto-retire otherwise-fine models for
  // a setup gap. Skip with ONE log line per provider instead. Credential
  // presence is cached so a multi-model provider is only checked once.
  const credentialOk = new Map<string, boolean>();
  const eligible: typeof models = [];
  for (const m of models) {
    let ok = credentialOk.get(m.providerId);
    if (ok === undefined) {
      ok = await providerHasConfiguredCredential(
        m.providerId,
        m.provider?.authMethod ?? null,
      );
      credentialOk.set(m.providerId, ok);
      if (!ok) {
        console.log(
          `[eval-runner] Skipping ${m.providerId}: no credential configured — not scheduling evals until the provider is set up`,
        );
      }
    }
    if (ok) eligible.push(m);
  }

  const results: EvalRunResult[] = [];
  for (const m of eligible) {
    try {
      const result = await runDimensionEval(m.providerId, m.modelId, triggeredBy);
      results.push(result);
    } catch (e) {
      console.error(`[eval-runner] failed to evaluate ${m.providerId}/${m.modelId}:`, e);
    }
  }
  return results;
}

import { randomUUID } from "node:crypto";
import { prisma, Prisma } from "@dpf/db";
import { callProvider, InferenceError } from "@/lib/ai-inference";
import { runGoldenTest } from "./eval-golden-test";
import { scoreDimension } from "./eval-scoring";
import { computeNewScore, resolveEvaluatedToolUse } from "./eval-runner";
import { BUILTIN_DIMENSIONS } from "./types";
import { currentGovernedInferenceDeadline, withGovernedInferenceDeadline, withInferenceAuthorityCheck, withInferenceCancellation } from "./governed-inference-deadline";
import { calibrationCorpus, calibrationJobId, lockCalibration, lockCalibrationIdentity, readCalibrationJournal,
  validateCalibrationCommission, type CalibrationAttempt, type CalibrationCommission, type CalibrationJournal } from "./subscription-calibration-admission";
import { createRoutingTraceId } from "./routing-trace";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const field = (dimension: string) => ({ instructionFollowing: "instructionFollowingScore", structuredOutput: "structuredOutputScore" }[dimension] ?? dimension);

async function currentCommissionAuthority(c: CalibrationCommission) {
  const [job, run] = await Promise.all([
    prisma.scheduledJob.findUnique({ where: { jobId: c.jobId } }),
    prisma.endpointTestRun.findUnique({ where: { runId: c.runId }, select: { endpointId: true, modelId: true, triggeredBy: true, status: true, taskType: true } }),
  ]);
  return job?.enabled === true && job.runCursor === c.runId
    && run?.endpointId === c.providerId && run.modelId === c.modelId && run.triggeredBy === c.userId
    && run.status === "running" && run.taskType === "dimension-eval"
    && readCalibrationJournal(job.metadata)?.state === "running" && await validateCalibrationCommission(c);
}

/** Every mutation verifies the same persisted commission; expiry never clears it. */
async function mutateJournal<T>(c: CalibrationCommission, mutate: (j: CalibrationJournal, db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async db => {
    await lockCalibration(db, c.jobId);
    const job = await db.scheduledJob.findUnique({ where: { jobId: c.jobId } });
    const j = readCalibrationJournal(job?.metadata);
    if (!job?.enabled || job.runCursor !== c.runId || j?.commission.runId !== c.runId) throw new Error("Calibration commission is no longer current.");
    const result = await mutate(j, db);
    await db.scheduledJob.update({ where: { jobId: c.jobId }, data: { metadata: json(j) } });
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
}

async function reserveAttempt(c: CalibrationCommission, testId: string, cap: number, traceId: string) {
  return mutateJournal(c, async (j, db) => {
    if (j.state !== "running" || j.attempts.some(a => a.disposition === "unknown")
      || !Number.isSafeInteger(cap) || cap <= 0 || j.attempts.length >= c.maxCalls
      || j.attempts.reduce((n, a) => n + a.cap, 0) + cap > c.maxOutputTokens
      || !await validateCalibrationCommission(c, db)) throw new Error("Calibration authority or reserved allowance is unavailable.");
    const a: CalibrationAttempt = { id: randomUUID(), testId, cap, traceId, disposition: "unknown" };
    // Unknown is durable BEFORE dispatch; a lost acknowledgement never frees it.
    j.attempts.push(a); return a;
  });
}

/** Dispatch still uses the canonical provider choke point and inherited authority. */
function commissionedDispatch(c: CalibrationCommission, testId: string): typeof callProvider {
  return async (...args) => {
    const plan = args[5];
    if (!plan || args[0] !== c.providerId || args[1] !== c.modelId) throw new Error("Calibration target changed.");
    const traceId = args[8]?.traceId ?? createRoutingTraceId();
    const attempt = await reserveAttempt(c, testId, plan.maxTokens!, traceId);
    args[5] = { ...plan, executionAdapter: "responses", providerConnectionId: c.proof.connectionId,
      providerConnectionVersion: c.proof.accountVersion, executionChannel: "direct-api", accountAuthMethod: "oauth2_authorization_code",
      responsePolicy: { ...plan.responsePolicy, requireOutputBound: true } };
    args[8] = { ...args[8], traceId };
    try {
      const result = await callProvider(...args);
      const terminal = ["completed", "max_output_tokens", "failed"].includes(result.finishReason ?? "");
      const usageBound = Number.isSafeInteger(result.outputTokens) && result.outputTokens > 0 && result.outputTokens <= attempt.cap;
      if (!terminal || !usageBound) throw new Error("Provider completion or output allowance is unverified; calibration is held.");
      await mutateJournal(c, async j => {
        const row = j.attempts.find(a => a.id === attempt.id);
        if (!row || row.disposition !== "unknown") throw new Error("Calibration attempt changed.");
        Object.assign(row, { disposition: "terminal", finishReason: result.finishReason, outputTokens: result.outputTokens,
          ...(result.responseId ? { responseId: result.responseId } : {}) });
      });
      return result;
    } catch (error) {
      // Only an actual known refusal permits the existing one rate-limit retry.
      const knownRateLimit = error instanceof InferenceError && error.code === "rate_limit"
        && (error.statusCode === 429 || error.localPoolExhausted === true);
      const knownRefusal = error instanceof InferenceError && [400, 401, 403, 404, 422].includes(error.statusCode ?? 0);
      if (knownRateLimit || knownRefusal) {
        await mutateJournal(c, async j => {
          const row = j.attempts.find(a => a.id === attempt.id);
          if (row?.disposition === "unknown") row.disposition = knownRateLimit ? "rate-limit" : "refused";
        });
      }
      throw error;
    }
  };
}

export async function runSubscriptionCalibration(input: { runId: string; endpointId: string; modelId: string; userId: string }) {
  const job = await prisma.scheduledJob.findUnique({ where: { jobId: calibrationJobId(input.endpointId, input.modelId) } });
  const journal = readCalibrationJournal(job?.metadata), c = journal?.commission;
  if (!c || job?.runCursor !== input.runId || c.runId !== input.runId || c.userId !== input.userId
    || c.providerId !== input.endpointId || c.modelId !== input.modelId) throw new Error("No matching commissioned calibration exists.");
  const claimed = await mutateJournal(c, async (j, db) => {
    if (j.state !== "queued") return false;
    if (!await validateCalibrationCommission(c, db)) throw new Error("Calibration admission is stale.");
    j.state = "running";
    await db.scheduledJob.update({ where: { jobId: c.jobId }, data: { lastStatus: "running", lastRunAt: new Date() } });
    return true;
  });
  if (!claimed) return { skipped: true, testRunId: c.runId, reason: "commission-already-started-or-unknown" };

  const execute = async () => {
    const supportTrace = createRoutingTraceId();
    const support = await commissionedDispatch(c, "output-bound-support")(c.providerId, c.modelId,
      [{ role: "user", content: "Print integers from 1 to 100000, one per line. Continue until the response limit. Do not summarize." }],
      "Follow the request until the response limit.", undefined,
      { providerId: c.providerId, modelId: c.modelId, recipeId: null, contractFamily: "model-calibration.dimension",
        executionAdapter: "responses", maxTokens: 32, providerSettings: {}, toolPolicy: {}, responsePolicy: { requireOutputBound: true } },
      undefined, undefined, { traceId: supportTrace });
    if (support.finishReason !== "max_output_tokens" || support.truncated !== true)
      return { supported: false, dimensions: [] };
    const model = await prisma.modelProfile.findUniqueOrThrow({ where: { providerId_modelId: { providerId: c.providerId, modelId: c.modelId } } });
    const dimensions = [];
    for (const dimension of BUILTIN_DIMENSIONS.filter(d => d !== "conversational")) {
      const tests = calibrationCorpus().filter(t => t.dimension === dimension);
      const results = [];
      for (const test of tests) {
        const result = await runGoldenTest(c.providerId, c.modelId, test, { requireComplete: true, dispatch: commissionedDispatch(c, test.id) });
        results.push(result);
        if (result.score === null || result.error) break;
      }
      const conclusive = results.length === tests.length && results.every(r => r.score !== null && !r.error);
      const previousScore = model[field(dimension) as keyof typeof model] as number;
      const rawScore = conclusive ? scoreDimension(results.map(r => r.score!)) : previousScore;
      dimensions.push({ dimension, tests: results, rawScore, previousScore,
        newScore: conclusive ? computeNewScore(rawScore, previousScore, model.evalCount) : previousScore, inconclusive: !conclusive });
      if (!conclusive) break;
    }
    return { supported: true, dimensions };
  };
  let observation: Awaited<ReturnType<typeof execute>> | undefined, error: string | undefined;
  try {
    const scoped = () => withInferenceAuthorityCheck(() => currentCommissionAuthority(c), execute);
    const parent = currentGovernedInferenceDeadline();
    if (parent) {
      const remaining = Math.min(parent.deadlineAt, c.deadlineAt) - Date.now();
      if (remaining <= 0) throw new Error("Calibration deadline exhausted.");
      observation = await withInferenceCancellation(AbortSignal.timeout(remaining), scoped);
    } else observation = await withGovernedInferenceDeadline({ deadlineAt: new Date(c.deadlineAt).toISOString(), verifyAuthority: () => currentCommissionAuthority(c) }, scoped);
  } catch (e) { error = e instanceof Error ? e.message : "Calibration outcome is unknown."; }

  await mutateJournal(c, async (j, db) => {
    await lockCalibrationIdentity(db, c);
    const authority = await validateCalibrationCommission(c, db);
    const unknown = j.attempts.some(a => a.disposition === "unknown");
    const dimensions = observation?.dimensions ?? [];
    const conclusive = authority && !unknown && !error && observation?.supported === true
      && dimensions.length === BUILTIN_DIMENSIONS.length - 1 && dimensions.every(d => !d.inconclusive);
    if (conclusive) {
      const model = await db.modelProfile.findUniqueOrThrow({ where: { providerId_modelId: { providerId: c.providerId, modelId: c.modelId } } });
      const scoreUpdates = Object.fromEntries(dimensions.map(d => [field(d.dimension), computeNewScore(d.rawScore, model[field(d.dimension) as keyof typeof model] as number, model.evalCount)]));
      const tool = dimensions.find(d => d.dimension === "toolFidelity");
      const capability = resolveEvaluatedToolUse({ toolFidelity: tool && { newScore: scoreUpdates.toolFidelity!, inconclusive: false }, capabilityOverrides: model.capabilityOverrides });
      await db.modelProfile.update({ where: { id: model.id }, data: { ...scoreUpdates, profileSource: "evaluated", lastEvalAt: new Date(),
        ...(capability === undefined ? {} : { supportsToolUse: capability, capabilities: { ...((model.capabilities as Record<string, Prisma.InputJsonValue>) ?? {}), toolUse: capability } }) } });
    }
    const summary = unknown ? "Provider outcome unknown; reconciliation required before another commission."
      : !authority ? "Calibration authority changed; no quality measurements were applied."
      : error ? "Calibration incomplete; no quality measurements were applied."
      : !observation?.supported ? "Output-bound support was not established; no golden tests were graded."
      : conclusive ? "Six dimensions measured; conversational quality remains unverified."
      : "Calibration incomplete; no quality measurements were applied.";
    await db.endpointTestRun.update({ where: { runId: c.runId, endpointId: c.providerId, modelId: c.modelId,
      triggeredBy: c.userId, status: "running", taskType: "dimension-eval" }, data: { status: "incomplete", completedAt: new Date(), avgScore: null,
      results: json({ commission: c, attempts: j.attempts, qualityWritesApplied: conclusive, summary,
        measurementScope: { fullCohortVerified: false, measuredDimensions: conclusive ? dimensions.map(d => d.dimension) : [],
          unverifiedDimensions: BUILTIN_DIMENSIONS.filter(d => !conclusive || !dimensions.some(v => v.dimension === d)) }, dimensions }) } });
    if (!unknown) j.state = "settled";
    await db.scheduledJob.update({ where: { jobId: c.jobId }, data: { lastStatus: "incomplete", lastRunSummary: summary,
      ...(!unknown ? { runCursor: null } : {}), lastError: error ?? null } });
  });
  return { testRunId: c.runId, skipped: false };
}

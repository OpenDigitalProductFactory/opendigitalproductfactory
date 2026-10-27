import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { prisma, type Prisma } from "@dpf/db";
import { DEFAULT_FIDELITY_THRESHOLD, DEFAULT_MIN_SAMPLE_COUNT } from "@/lib/routing/tool-fidelity-policy";

export type FidelityObservation = {
  surfaceSize: number; caseIndex: number; taskClass: string;
  status: "unrun" | "incomplete" | "failed" | "passed";
  selectionPassed: boolean; executionPassed: boolean; reason: string;
  traceId?: string; toolExecutionId?: string;
  timing?: { queuedAt?: number; acquiredAt?: number; releasedAt?: number;
    canceledAt?: number; admissionTimedOutAt?: number; phaseAtStop: "waiting" | "after-acquisition" | "unknown";
    providerDispatch: "unverified" };
};
type Checkpoint = {
  revision: number; state: "ready" | "running" | "held" | "completed";
  nextIndex: number; expiresAt: number; stepBudgetMs: number;
  fence?: string; claimExpiresAt?: number; reason?: string;
};
type Stored = {
  protocol: "local-fidelity-checkpoint-v1"; ownerHash: string; bindingHash: string;
  identity: unknown; observations: FidelityObservation[]; checkpoint: Checkpoint;
  cohorts?: ReturnType<typeof fidelityCohorts>; qualified?: boolean;
  capChanged?: false; classSpecificQualification?: false; runtimeAcceptance?: "unverified";
};
type Row = { id: string; runId: string; triggeredBy: string; taskType: string | null;
  status: string; results: unknown };
type Request = { runId: string; userId: string; ownerHash: string; bindingHash: string;
  observationIndex: number; now: number; stepBudgetMs?: number };
export type FidelityClaim = { kind: "claimed"; row: Row; stored: Stored; fence: string;
  observationIndex: number; expiresAt: number };
type Readback = { kind: "readback" | "held" | "busy"; runId: string; stored: Stored };
const json = (value: unknown) => value as Prisma.InputJsonValue;
const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
export const fidelityRunIdFor = (userId: string, ownerHash: string, bindingHash: string) =>
  `fidelity-${digest([userId, ownerHash, bindingHash])}`;

/** Completed negatives stay in the denominator; every declared case is required. */
export function fidelityCohorts(observations: FidelityObservation[]) {
  return [8, 15, 24, 32, 48].map(surfaceSize => {
    const group = observations.filter(o => o.surfaceSize === surfaceSize);
    const complete = group.length === 9 && group.every(o => o.status === "passed" || o.status === "failed");
    const selectionAccuracy = group.filter(o => o.selectionPassed).length / 9;
    const executionAccuracy = group.filter(o => o.executionPassed).length / 9;
    return { surfaceSize, sampleCount: group.filter(o => o.status === "passed" || o.status === "failed").length,
      complete, selectionAccuracy, executionAccuracy, qualified: complete && group.length >= DEFAULT_MIN_SAMPLE_COUNT
        && selectionAccuracy >= DEFAULT_FIDELITY_THRESHOLD && executionAccuracy >= DEFAULT_FIDELITY_THRESHOLD };
  });
}

function withSummary(stored: Stored): Stored {
  const cohorts = fidelityCohorts(stored.observations);
  return { ...stored, cohorts, qualified: stored.checkpoint.state === "completed" && cohorts.every(c => c.qualified),
    capChanged: false, classSpecificQualification: false, runtimeAcceptance: "unverified" };
}

function authorized(row: Row | null, request: Pick<Request, "userId" | "ownerHash" | "bindingHash">): Stored {
  const stored = row?.results as Stored | null;
  if (!row || row.triggeredBy !== request.userId || row.taskType !== "tool-fidelity"
    || stored?.protocol !== "local-fidelity-checkpoint-v1"
    || stored.ownerHash !== request.ownerHash || stored.bindingHash !== request.bindingHash
    || !Array.isArray(stored.observations) || !stored.checkpoint) {
    throw new Error("fidelity_authority_unverified");
  }
  return stored;
}

/** The existing unique runId is the cohort's durable idempotency key.
 * No caller nonce can create a second execution of a held cohort. */
export async function createFidelityCheckpoint(input: {
  userId: string; ownerHash: string; bindingHash: string; identity: unknown;
  endpointId: string; modelId: string; now: number; stepBudgetMs: number;
  schedule: FidelityObservation[];
}): Promise<{ runId: string; stored: Stored }> {
  if (!/^[a-f0-9]{64}$/.test(input.ownerHash) || !/^[a-f0-9]{64}$/.test(input.bindingHash)
    || !Number.isSafeInteger(input.now) || !Number.isSafeInteger(input.stepBudgetMs)
    || input.stepBudgetMs <= 0 || input.stepBudgetMs > 2_147_483_647
    || input.schedule.length !== 45 || input.schedule.some(o => o.status !== "unrun"
      || o.selectionPassed || o.executionPassed)) throw new Error("fidelity_checkpoint_invalid");
  const expiresAt = input.now + input.stepBudgetMs * input.schedule.length;
  if (!Number.isSafeInteger(expiresAt)) throw new Error("fidelity_checkpoint_invalid");
  const runId = fidelityRunIdFor(input.userId, input.ownerHash, input.bindingHash);
  const stored: Stored = withSummary({ protocol: "local-fidelity-checkpoint-v1", ownerHash: input.ownerHash,
    bindingHash: input.bindingHash, identity: input.identity, observations: input.schedule,
    checkpoint: { revision: 0, state: "ready", nextIndex: 0, expiresAt, stepBudgetMs: input.stepBudgetMs } });
  try {
    await prisma.endpointTestRun.create({ data: { runId, endpointId: input.endpointId,
      modelId: input.modelId, taskType: "tool-fidelity", triggeredBy: input.userId,
      probesOnly: false, status: "running", results: json(stored) } });
    return { runId, stored };
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
    const row = await prisma.endpointTestRun.findUnique({ where: { runId } });
    return { runId, stored: authorized(row, input) };
  }
}

async function write(row: Row, stored: Stored, next: Stored, status: string, now: number) {
  const result = await prisma.endpointTestRun.updateMany({
    where: { id: row.id, status: row.status, results: { equals: json(stored) } },
    data: { status, results: json(withSummary(next)), ...(status === "running" ? {} : { completedAt: new Date(now) }) },
  });
  return result.count === 1;
}

function hold(stored: Stored, reason: string): Stored {
  return { ...stored, checkpoint: { ...stored.checkpoint, revision: stored.checkpoint.revision + 1,
    state: "held", reason }, qualified: false };
}

/** A claim is persisted before inference. Started cases are never stolen. */
export async function claimFidelityObservation(request: Request): Promise<FidelityClaim | Readback> {
  if (!Number.isSafeInteger(request.now) || !Number.isSafeInteger(request.observationIndex)
    || request.observationIndex < 0 || request.observationIndex >= 45) throw new Error("fidelity_checkpoint_invalid");
  const row = await prisma.endpointTestRun.findUnique({ where: { runId: request.runId } });
  const stored = authorized(row, request);
  const cp = stored.checkpoint;
  const response = (kind: Readback["kind"], value = stored): Readback => ({ kind, runId: request.runId, stored: value });
  if (cp.state === "held") return response("held");
  if (request.observationIndex < cp.nextIndex) return response("readback");
  if (cp.state === "running" && request.now >= cp.claimExpiresAt!) {
    const next = hold(stored, "execution_unsettled");
    if (await write(row!, stored, next, "incomplete", request.now)) return response("held", next);
    return response("busy");
  }
  if (request.now >= cp.expiresAt) {
    const next = hold(stored, "checkpoint_expired");
    if (await write(row!, stored, next, "incomplete", request.now)) return response("held", next);
    return response("busy");
  }
  if (cp.state !== "ready" || request.observationIndex !== cp.nextIndex) return response("busy");
  const fence = randomUUID();
  const expiresAt = Math.min(cp.expiresAt, request.now + cp.stepBudgetMs);
  const next: Stored = { ...stored, checkpoint: { ...cp, revision: cp.revision + 1,
    state: "running", fence, claimExpiresAt: expiresAt } };
  if (!await write(row!, stored, next, "running", request.now)) return response("busy");
  return { kind: "claimed", row: { ...row!, results: next }, stored: next,
    fence, observationIndex: request.observationIndex, expiresAt };
}

/** Compare the exact claim snapshot: expired or superseded workers cannot advance it. */
export async function completeFidelityObservation(claim: FidelityClaim, observation: FidelityObservation, now: number): Promise<boolean> {
  const cp = claim.stored.checkpoint;
  const expected = claim.stored.observations[claim.observationIndex]!;
  if (!Number.isSafeInteger(now) || cp.state !== "running" || cp.fence !== claim.fence
    || observation.surfaceSize !== expected.surfaceSize || observation.caseIndex !== expected.caseIndex
    || observation.taskClass !== expected.taskClass) throw new Error("fidelity_checkpoint_invalid");
  const late = now >= claim.expiresAt;
  const accepted = late ? { ...observation, status: "incomplete" as const, selectionPassed: false,
    executionPassed: false, reason: "observation_expired" } : observation;
  const observations = claim.stored.observations.map((old, index) => index === claim.observationIndex ? accepted : old);
  const incomplete = accepted.status === "incomplete" || accepted.status === "unrun";
  const nextIndex = incomplete ? cp.nextIndex : cp.nextIndex + 1;
  const next: Stored = { ...claim.stored, observations, checkpoint: { revision: cp.revision + 1,
    expiresAt: cp.expiresAt, stepBudgetMs: cp.stepBudgetMs, nextIndex,
    state: incomplete ? "held" : nextIndex === observations.length ? "completed" : "ready",
    ...(incomplete ? { reason: accepted.reason } : {}) } };
  return write(claim.row, claim.stored, next,
    incomplete ? "incomplete" : nextIndex === observations.length ? "completed" : "running", now);
}

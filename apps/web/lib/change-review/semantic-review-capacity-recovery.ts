import { isRecord } from "@/lib/shared/coerce";
import { LocalProviderCapacityDeferredError } from "@/lib/routing/local-provider-capacity";
import { restoreSemanticReviewCheckpoint } from "./semantic-change-review";
import { SEMANTIC_REVIEW_MAX_ATTEMPTS, isSemanticReviewCapacityReason } from "./semantic-review-recovery-policy";
const record = (value: unknown) => isRecord(value) ? value : {};
const digestPattern = /^[a-f0-9]{64}$/;
const counter = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Only the real direct refusal can attest that this branch never dispatched. */
export function capacityDeferralProof(error: unknown, requestDigest: string, generation: string) {
  return error instanceof LocalProviderCapacityDeferredError && isSemanticReviewCapacityReason(error.reason)
    && digestPattern.test(requestDigest) && generation.length > 0
    ? { schemaVersion: 1, requestDigest, generation, reason: error.reason } : null;
}

type Checkpoint = { taskNodeId: string; status: string; requestContract?: unknown; outputSnapshot?: unknown };
type CheckpointInput = {
  nodes: readonly Checkpoint[]; taskRunId: string; requestDigest: string;
  recoveryAttempt: unknown; specialistIds: readonly string[];
};

function completeCheckpointSet(input: CheckpointInput) {
  const { nodes, taskRunId, requestDigest, recoveryAttempt, specialistIds } = input;
  if (!counter(recoveryAttempt) || recoveryAttempt > SEMANTIC_REVIEW_MAX_ATTEMPTS
    || !digestPattern.test(requestDigest) || !nodes.length || nodes.length > 100 || specialistIds.length > 20) return null;
  const agents = [...new Set(["change-reviewer", ...specialistIds])];
  const expected = new Map<string, string>();
  for (const agent of agents) for (let attempt = 0; attempt <= recoveryAttempt; attempt += 1) {
    expected.set(`semantic-review:${taskRunId}:${agent}${attempt ? `:recovery-${attempt}` : ""}`, agent);
  }
  const active = nodes.filter(node => node.status !== "superseded");
  if (new Set(active.map(node => node.taskNodeId)).size !== active.length) return null;
  if (active.some(node => node.status !== "completed" || !expected.has(node.taskNodeId)
    || record(node.outputSnapshot).requestDigest !== requestDigest
    || record(node.requestContract).requestDigest !== requestDigest
    || record(node.requestContract).agentId !== expected.get(node.taskNodeId))) return null;
  const selected: Array<{ node: Checkpoint; agent: string }> = [];
  for (const agent of agents) {
    let node: Checkpoint | undefined;
    for (let attempt = recoveryAttempt; attempt >= 0 && !node; attempt -= 1) {
      node = active.find(candidate => candidate.taskNodeId === `semantic-review:${taskRunId}:${agent}${attempt ? `:recovery-${attempt}` : ""}`);
    }
    if (!node) return null;
    selected.push({ node, agent });
  }
  return selected;
}

/** Complete verdicts can be republished after loss without another provider invocation. */
export function hasFinalReviewCheckpointSet(input: CheckpointInput): boolean {
  return completeCheckpointSet(input)?.every(({ node, agent }) => {
    const decision = restoreSemanticReviewCheckpoint(record(node.outputSnapshot).result, agent).decision;
    return decision === "pass" || decision === "fail";
  }) ?? false;
}

/** Positive complete-set proof; an absent or unsupported checkpoint is never a retry permit. */
export function hasProvenCapacityCheckpointSet(input: CheckpointInput): boolean {
  const selected = completeCheckpointSet(input);
  if (!selected) return false;
  let deferred = false;
  for (const { node, agent } of selected) {
    const output = record(node.outputSnapshot);
    const result = record(output.result);
    const restored = restoreSemanticReviewCheckpoint(output.result, agent);
    if (restored.decision === "pass") continue;
    const proof = record(output.capacityDeferral);
    const contract = record(node.requestContract);
    if (restored.decision !== "inconclusive" || result.decision !== "inconclusive" || result.inconclusiveReason !== "review-capacity-deferred"
      || !Array.isArray(result.issues) || result.issues.length !== 0
      || output.providerOutcome !== "not-dispatched" || proof.schemaVersion !== 1
      || proof.requestDigest !== input.requestDigest || typeof proof.generation !== "string" || !proof.generation
      || proof.generation !== contract.generation || !isSemanticReviewCapacityReason(proof.reason)) return false;
    deferred = true;
  }
  return deferred;
}

/** One branch checkpoint carries the typed pre-dispatch refusal bound to its own request and generation. */
function provenDeferral(node: Checkpoint, requestDigest: string): boolean {
  const output = record(node.outputSnapshot);
  const result = record(output.result);
  const proof = record(output.capacityDeferral);
  const contract = record(node.requestContract);
  return (output.providerOutcome === "not-dispatched" || (node.status === "superseded" && output.providerOutcome === "inconclusive"))
    && result.decision === "inconclusive" && result.inconclusiveReason === "review-capacity-deferred"
    && Array.isArray(result.issues) && result.issues.length === 0
    && proof.schemaVersion === 1 && proof.requestDigest === requestDigest
    && typeof proof.generation === "string" && proof.generation.length > 0 && proof.generation === contract.generation
    && isSemanticReviewCapacityReason(proof.reason);
}

/**
 * BI-49AA6BE8. Every checkpoint this review ever wrote is either a typed
 * pre-dispatch capacity refusal or a completed passing verdict, so no provider
 * work is outstanding and nothing needs settling. Any running, failed or
 * unknown branch, a failing verdict, or a binding mismatch refuses: this is the
 * only evidence class that may start a successor without a recorded health
 * verification.
 */
export function hasProvenNoDispatchLineage(input: { nodes: readonly Checkpoint[]; requestDigest: string }): boolean {
  const { nodes, requestDigest } = input;
  if (!digestPattern.test(requestDigest) || !nodes.length || nodes.length > 100) return false;
  let deferred = false;
  for (const node of nodes) {
    const output = record(node.outputSnapshot);
    const contract = record(node.requestContract);
    if (output.requestDigest !== requestDigest || contract.requestDigest !== requestDigest || typeof contract.agentId !== "string") return false;
    if (node.status !== "completed" && node.status !== "superseded") return false;
    if (record(output.result).decision === "fail") return false;
    if (provenDeferral(node, requestDigest)) { deferred = true; continue; }
    if (node.status !== "completed" || restoreSemanticReviewCheckpoint(output.result, contract.agentId).decision !== "pass") return false;
  }
  return deferred;
}

/**
 * Time this generation spent before its capacity refusals, e.g. queued for the
 * single local runner. Credited only when every branch the generation ran was
 * refused before dispatch; the shortest wait bounds the credit.
 */
export function generationCapacityWaitMs(nodes: readonly Checkpoint[], requestDigest: string, generation: string): number {
  const ran = nodes.filter(node => record(node.requestContract).generation === generation);
  if (!ran.length || !ran.every(node => node.status === "completed" && provenDeferral(node, requestDigest))) return 0;
  const waits = ran.map(node => record(node.outputSnapshot).waitedBeforeRefusalMs);
  return waits.every(counter) ? Math.min(...waits as number[]) : 0;
}

/**
 * Local observation budget, never an attempt allowance. waitStartedAt opens a
 * bounded deadline credit (semanticReviewCapacityWaitMs); a recheck carries
 * the original start forward so one wait is credited once.
 */
export function capacityRecoveryMarker(requestDigest: string, now: number, checks = 0,
  waitStartedAt = new Date(now).toISOString()) {
  return { schemaVersion: 1, requestDigest, checks,
    nextCheckAt: new Date(now + Math.min(30_000 * 2 ** Math.min(checks, 4), 300_000)).toISOString(), waitStartedAt };
}

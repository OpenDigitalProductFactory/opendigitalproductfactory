import { createTrustedLoop, advanceTrustedLoop, type TrustedLoopResult } from "./trusted-agent-reference-loop";
import { importTrustedArtifact } from "./trusted-agent-contracts";
import type { TrustedWorkDefinition, TrustedOperatingProfile, TrustedDecision, TrustedEffectBinding, TrustedEffectReceipt } from "./trusted-agent-contracts";

/** Simulated, in-memory inputs; none of these references grants authority. */
export function trustedAgentExample() {
  const ref = (id: string) => ({ id, version: "1" });
  const now = "2026-10-01T00:00:00Z";
  const restrictions = { classificationRef: ref("restricted"), accessPolicyRef: ref("access"), retentionPolicyRef: ref("retention"), destinationPolicyRef: ref("destination") };
  const common = { schemaVersion: "0.1.0" as const, id: "simulated", sourceRef: ref("source"), restrictions, extensions: [] };
  const work: TrustedWorkDefinition = {
    ...common, kind: "work-definition", activity: ref("work"), purpose: "Review a simulated change", scope: "wwmd",
    accountablePrincipalRef: ref("owner"), flow: "sequential", gpp: false, capabilities: [ref("review")],
    stages: [{ id: "review", consequential: true, capabilityIds: ["review"], next: [], gppBindings: [] }],
    requiredEvidence: [], limits: { steps: 30, attempts: 2, reconciliations: 3 }, stopConditions: ["cancelled"], reviewConditions: ["budget exhausted"],
  };
  const profile: TrustedOperatingProfile = {
    ...common, kind: "operating-profile", subjectRef: ref("agent"), principalRef: ref("owner"), composition: ref("profile"),
    instructions: [ref("instructions")], skills: [], models: [ref("model")], tools: [ref("review")],
    doctrine: [{ scope: "wwmd", profileRef: ref("doctrine") }], qualifications: [],
  };
  const binding: TrustedEffectBinding = {
    effectId: "effect", actorRef: ref("agent"), toolRef: ref("review"), targetRef: ref("resource"), accountRef: ref("account"),
    argumentDigest: "sha256:" + "a".repeat(64), canonicalization: "RFC8785", purpose: work.purpose,
    workRef: work.activity, profileRef: profile.composition, policyGeneration: "policy-1", gppBindings: [],
  };
  const decision: TrustedDecision = {
    ...common, kind: "decision", sourceRef: ref("decision"), workRef: work.activity, profileRef: profile.composition, scope: work.scope,
    eligibleOptionIds: ["review-change"], selectedOptionId: "review-change", constraintsSatisfied: true, disposition: "proceed", reasonCodes: ["eligible"], evidence: [],
  };
  const receipt: TrustedEffectReceipt = {
    ...common, kind: "effect-receipt", sourceRef: ref("receipt"), decisionRef: decision.sourceRef, authorizationRef: ref("authorization"),
    binding, attemptId: "attempt-1", observation: "unknown", recordedAt: now, evidence: [],
  };
  return { simulated: true as const, now, work, profile, binding, decision, receipt, ref };
}

/** Deterministic demonstration of the public protocol. No tool is actually invoked. */
export function runTrustedAgentExamples() {
  const f = trustedAgentExample();
  const init = () => createTrustedLoop({ work: f.work, profile: f.profile, binding: f.binding, stageId: "review", optionId: "review-change", attemptId: "attempt-1", now: f.now });
  function step(previous: TrustedLoopResult, kind: string, fields: Record<string, unknown> = {}) {
    if (!previous.ok) return previous;
    return advanceTrustedLoop(previous.state, { kind, now: f.now, binding: f.binding, attemptId: previous.state.attemptId, ...fields });
  }
  const deciding = step(init(), "begin");
  const authorized = step(step(deciding, "decision", { decision: f.decision }), "authorization", { disposition: "proceed", authorizationRef: f.ref("authorization"), expiresAt: "2026-10-01T00:01:00Z" });
  const dispatched = step(authorized, "reservation", { reserved: true, reservationRef: f.ref("reservation") });
  const success = step(dispatched, "observation", { receipt: { ...f.receipt, observation: "succeeded", evidence: [f.ref("simulated-target-proof")] } });
  const { selectedOptionId: _, ...unselected } = f.decision;
  const refusal = step(deciding, "decision", { decision: { ...unselected, disposition: "refused", constraintsSatisfied: false } });
  const scopeMismatch = step(deciding, "decision", { decision: { ...f.decision, scope: "wwwd" } });
  const unknown = step(dispatched, "observation", { receipt: f.receipt });
  const reconciled = step(unknown, "observation", { receipt: { ...f.receipt, observation: "no-effect", evidence: [f.ref("simulated-no-effect-proof")] } });
  const retry = step(reconciled, "retry", { nextAttemptId: "attempt-2" });
  const extension = { id: "example:annotation", version: "1", mandatory: false, data: { reference: "simulated-note" } };
  return {
    simulated: true, conformanceClaim: "none", success, refusal, scopeMismatch, unknown, retry,
    optionalExtension: importTrustedArtifact({ ...f.work, extensions: [extension] }),
    mandatoryExtension: importTrustedArtifact({ ...f.work, extensions: [{ ...extension, mandatory: true }] }),
  };
}

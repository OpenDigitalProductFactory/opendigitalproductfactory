import { z } from "zod";
import { DECISION_SCOPES } from "./decision-scope";
import { OUTCOME_DISPOSITIONS, type OutcomeDisposition } from "./outcome-disposition";
import {
  importTrustedArtifact, isBoundedTrustedJson, sameTrustedReference,
  trustedDecisionSchema, trustedEffectBindingSchema, trustedEffectReceiptSchema,
  trustedReferenceSchema, trustedRestrictionsSchema, trustedWorkDefinitionSchema,
  trustedOperatingProfileSchema, type TrustedEffectBinding, type TrustedImportOptions,
  type TrustedReference,
} from "./trusted-agent-contracts";

const id = z.string().min(1).max(512);
const time = z.iso.datetime({ offset: true });
const phases = ["ready", "awaiting-decision", "awaiting-authorization", "awaiting-reservation", "awaiting-dispatch", "awaiting-reconciliation", "stopped"] as const;
const observations = ["not-submitted", "succeeded", "no-effect", "unknown"] as const;

/** Persist this together with an adapter-owned revision/CAS, not in model-controlled memory. */
export const trustedLoopStateSchema = z.strictObject({
  schemaVersion: z.literal("0.1.0"), phase: z.enum(phases),
  binding: trustedEffectBindingSchema, stageId: id, optionId: id, scope: z.enum(DECISION_SCOPES),
  resolverRef: trustedReferenceSchema, doctrineRef: trustedReferenceSchema,
  workSourceRef: trustedReferenceSchema, profileSourceRef: trustedReferenceSchema,
  restrictions: z.strictObject({ work: trustedRestrictionsSchema, profile: trustedRestrictionsSchema }),
  limits: trustedWorkDefinitionSchema.shape.limits, requiredEvidence: z.array(trustedReferenceSchema).max(128),
  steps: z.int().nonnegative().max(10000), attempts: z.int().positive().max(100),
  reconciliations: z.int().nonnegative().max(100), attemptId: id,
  usedAttemptIds: z.array(id).min(1).max(100), observedAt: time,
  decisionRef: trustedReferenceSchema.nullable(), authorizationRef: trustedReferenceSchema.nullable(),
  authorizationExpiresAt: time.nullable(), reservationRef: trustedReferenceSchema.nullable(),
  observation: z.enum(observations).nullable(), revoked: z.boolean(), cancelled: z.boolean(),
  disposition: z.enum(OUTCOME_DISPOSITIONS).nullable(), reason: id.nullable(),
});
export type TrustedLoopState = z.infer<typeof trustedLoopStateSchema>;
const correlation = { now: time, binding: trustedEffectBindingSchema, attemptId: id };
export const trustedLoopEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...correlation, kind: z.literal("begin") }),
  z.strictObject({ ...correlation, kind: z.literal("decision"), decision: trustedDecisionSchema }),
  z.strictObject({ ...correlation, kind: z.literal("authorization"), disposition: z.enum(OUTCOME_DISPOSITIONS), authorizationRef: trustedReferenceSchema, expiresAt: time.optional(), resolverRef: trustedReferenceSchema.optional() }),
  z.strictObject({ ...correlation, kind: z.literal("reservation"), reserved: z.boolean(), reservationRef: trustedReferenceSchema.optional() }),
  z.strictObject({ ...correlation, kind: z.literal("observation"), receipt: trustedEffectReceiptSchema }),
  z.strictObject({ ...correlation, kind: z.literal("retry"), nextAttemptId: id }),
  z.strictObject({ ...correlation, kind: z.literal("recover") }),
  z.strictObject({ ...correlation, kind: z.literal("revoked") }),
  z.strictObject({ ...correlation, kind: z.literal("cancel") }),
]);
export type TrustedLoopEvent = z.infer<typeof trustedLoopEventSchema>;
type BoundCommand = { binding: TrustedEffectBinding; attemptId: string };
export type TrustedLoopCommand = BoundCommand & (
  | { kind: "request-decision"; scope: TrustedLoopState["scope"]; doctrineRef: TrustedReference; optionId: string; requiredEvidence: TrustedReference[] }
  | { kind: "request-authorization"; decisionRef: TrustedReference }
  | { kind: "reserve-effect"; decisionRef: TrustedReference; authorizationRef: TrustedReference }
  | { kind: "mediated-dispatch"; decisionRef: TrustedReference; authorizationRef: TrustedReference; reservationRef: TrustedReference; recheckAtUse: true; checks: readonly string[] }
  | { kind: "reconcile-effect"; reservationRef: TrustedReference; observationOnly: true }
  | { kind: "record-outcome"; receiptRef: TrustedReference; observation: NonNullable<TrustedLoopState["observation"]> }
  | { kind: "hold"; disposition: OutcomeDisposition; resolverRef: TrustedReference; reason: string }
);
export type TrustedLoopResult = { ok: true; state: TrustedLoopState; commands: TrustedLoopCommand[] }
  | { ok: false; error: "invalid-input" | "invalid-state" | "binding-changed" | "unexpected-event" | "invalid-decision" | "invalid-receipt" };
const reject = (error: Extract<TrustedLoopResult, { ok: false }>["error"]): TrustedLoopResult => ({ ok: false, error });
const result = (state: TrustedLoopState, commands: TrustedLoopCommand[] = []): TrustedLoopResult => ({ ok: true, state, commands });
const bound = (s: TrustedLoopState): BoundCommand => ({ binding: s.binding, attemptId: s.attemptId });

// Equality for already bounded plain JSON; property order is not semantic.
function equalJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a).sort(); const right = Object.keys(b).sort();
  return left.length === right.length && left.every((key, index) => key === right[index] && equalJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
function hold(s: TrustedLoopState, disposition: OutcomeDisposition, reason: string): TrustedLoopResult {
  const state = { ...s, phase: "stopped" as const, disposition, reason };
  return result(state, [{ ...bound(state), kind: "hold", disposition, resolverRef: state.resolverRef, reason }]);
}
function reconcile(s: TrustedLoopState): TrustedLoopResult {
  if (!s.reservationRef) return reject("invalid-state");
  if (s.reconciliations >= s.limits.reconciliations) return hold(s, "inconclusive", "reconciliation-budget-exhausted");
  const state = { ...s, phase: "awaiting-reconciliation" as const, observation: "unknown" as const, reconciliations: s.reconciliations + 1 };
  return result(state, [{ ...bound(state), kind: "reconcile-effect", reservationRef: s.reservationRef, observationOnly: true }]);
}
function expired(s: TrustedLoopState, now: string): boolean {
  return [s.restrictions.work, s.restrictions.profile].some(r => r.expiresAt && Date.parse(r.expiresAt) <= Date.parse(now));
}

/** One declared consequential stage/effect. Workflow coordination stays with the owning harness. */
function createLoop(input: unknown, options: TrustedImportOptions = {}): TrustedLoopResult {
  if (!isBoundedTrustedJson(input)) return reject("invalid-input");
  const parsed = z.strictObject({ work: trustedWorkDefinitionSchema, profile: trustedOperatingProfileSchema, binding: trustedEffectBindingSchema, stageId: id, optionId: id, attemptId: id, now: time }).safeParse(input);
  if (!parsed.success) return reject("invalid-input");
  const { work, profile, binding, stageId, optionId, attemptId, now } = parsed.data;
  if (!importTrustedArtifact(work, { ...options, now }).ok || !importTrustedArtifact(profile, { ...options, now }).ok) return reject("invalid-input");
  const stage = work.stages.find(s => s.id === stageId);
  const doctrine = profile.doctrine.find(d => d.scope === work.scope);
  if (!stage?.consequential || !doctrine || !sameTrustedReference(work.activity, binding.workRef)
    || !sameTrustedReference(profile.composition, binding.profileRef) || !sameTrustedReference(profile.subjectRef, binding.actorRef)
    || binding.purpose !== work.purpose || !stage.capabilityIds.includes(binding.toolRef.id)
    || !work.capabilities.some(c => sameTrustedReference(c, binding.toolRef))
    || !profile.tools.some(c => sameTrustedReference(c, binding.toolRef))
    || !equalJson(stage.gppBindings, binding.gppBindings)) return reject("binding-changed");
  const state: TrustedLoopState = {
    schemaVersion: "0.1.0", phase: "ready", binding, stageId, optionId, scope: work.scope,
    resolverRef: work.accountablePrincipalRef, doctrineRef: doctrine.profileRef,
    workSourceRef: work.sourceRef, profileSourceRef: profile.sourceRef,
    restrictions: { work: work.restrictions, profile: profile.restrictions }, limits: work.limits, requiredEvidence: work.requiredEvidence,
    steps: 0, attempts: 1, reconciliations: 0, attemptId, usedAttemptIds: [attemptId], observedAt: now,
    decisionRef: null, authorizationRef: null, authorizationExpiresAt: null, reservationRef: null,
    observation: null, revoked: false, cancelled: false, disposition: null, reason: null,
  };
  if (binding.gppBindings.some(b => b.mode !== "enforce" || Date.parse(b.observedAt) > Date.parse(now))) return hold(state, "awaiting-input", "gpp-enforcement-unproven");
  return result(state);
}

function validState(s: TrustedLoopState): boolean {
  if (s.steps > s.limits.steps || s.attempts > s.limits.attempts || s.reconciliations > s.limits.reconciliations
    || s.usedAttemptIds.length !== s.attempts || new Set(s.usedAttemptIds).size !== s.attempts
    || s.usedAttemptIds.at(-1) !== s.attemptId) return false;
  if (s.phase === "stopped") return s.disposition !== null && s.reason !== null;
  if (s.disposition !== null || s.reason !== null) return false;
  if (["awaiting-authorization", "awaiting-reservation", "awaiting-dispatch", "awaiting-reconciliation"].includes(s.phase) && !s.decisionRef) return false;
  if (["awaiting-reservation", "awaiting-dispatch", "awaiting-reconciliation"].includes(s.phase) && (!s.authorizationRef || !s.authorizationExpiresAt)) return false;
  if (["awaiting-dispatch", "awaiting-reconciliation"].includes(s.phase) && !s.reservationRef) return false;
  if (s.phase === "awaiting-reconciliation") return s.observation === "unknown" || s.observation === "no-effect" || s.observation === "not-submitted";
  return s.observation === null;
}

/**
 * Pure protocol, not an authority issuer. The authenticated adapter serializes
 * transitions, durably reserves and consumes a dispatch once, rechecks at use,
 * and supplies truthful observations. Replaying an old state is not safe storage.
 */
function advanceLoop(input: unknown, eventInput: unknown, options: TrustedImportOptions = {}): TrustedLoopResult {
  if (!isBoundedTrustedJson(input) || !isBoundedTrustedJson(eventInput)) return reject("invalid-input");
  const parsed = trustedLoopStateSchema.safeParse(input); const eventParsed = trustedLoopEventSchema.safeParse(eventInput);
  if (!parsed.success || !eventParsed.success) return reject("invalid-input");
  const previous = parsed.data; const event = eventParsed.data;
  if (!validState(previous)) return reject("invalid-state");
  if (!equalJson(previous.binding, event.binding) || previous.attemptId !== event.attemptId) return reject("binding-changed");
  if (Date.parse(event.now) < Date.parse(previous.observedAt)) return reject("invalid-input");
  if (previous.phase === "stopped") return reject("unexpected-event");
  if (previous.steps >= previous.limits.steps) {
    // A dispatch command may already have been consumed. Preserve that uncertainty.
    const uncertain = previous.phase === "awaiting-dispatch" ? { ...previous, observation: "unknown" as const } : previous;
    return hold(uncertain, "inconclusive", "step-budget-exhausted");
  }
  const s = { ...previous, steps: previous.steps + 1, observedAt: event.now };
  const possiblySubmitted = s.phase === "awaiting-dispatch" || s.phase === "awaiting-reconciliation";
  if (event.kind === "cancel" || event.kind === "revoked") {
    s.revoked = true;
    s.cancelled ||= event.kind === "cancel";
    if (possiblySubmitted) {
      // Keep the attempt observable after revocation; never infer target rollback.
      if (s.phase === "awaiting-dispatch") return reconcile(s);
      if (s.cancelled && s.observation !== "unknown") return hold(s, "awaiting-input", "work-cancelled");
      return result(s, [{ ...bound(s), kind: "hold", disposition: "inconclusive", resolverRef: s.resolverRef, reason: "submission-revoked-observation-only" }]);
    }
    return hold(s, "awaiting-input", "authority-needs-renewal");
  }
  if (event.kind === "recover") {
    if (!possiblySubmitted || s.observation === "no-effect" || s.observation === "not-submitted") return reject("unexpected-event");
    return reconcile(s);
  }
  // Old effect observations remain admissible after policy expiry; submissions do not.
  if (!possiblySubmitted && expired(s, event.now)) return hold(s, "awaiting-input", "source-policy-expired");
  if (event.kind === "begin" && s.phase === "ready") {
    return result({ ...s, phase: "awaiting-decision" }, [{ ...bound(s), kind: "request-decision", scope: s.scope, doctrineRef: s.doctrineRef, optionId: s.optionId, requiredEvidence: s.requiredEvidence }]);
  }
  if (event.kind === "decision" && s.phase === "awaiting-decision") {
    const d = event.decision;
    if (!importTrustedArtifact(d, { ...options, now: event.now }).ok || d.scope !== s.scope
      || !sameTrustedReference(d.workRef, s.binding.workRef) || !sameTrustedReference(d.profileRef, s.binding.profileRef)
      || (d.disposition === "proceed" && (d.selectedOptionId !== s.optionId || s.requiredEvidence.some(r => !d.evidence.some(e => sameTrustedReference(e, r)))))) return reject("invalid-decision");
    s.decisionRef = d.sourceRef;
    if (d.disposition !== "proceed") return hold({ ...s, resolverRef: d.resolverRef ?? s.resolverRef }, d.disposition, "owning-scope-decision");
    return result({ ...s, phase: "awaiting-authorization" }, [{ ...bound(s), kind: "request-authorization", decisionRef: d.sourceRef }]);
  }
  if (event.kind === "authorization" && s.phase === "awaiting-authorization") {
    if (event.disposition !== "proceed") return hold({ ...s, resolverRef: event.resolverRef ?? s.resolverRef }, event.disposition, "current-authorization");
    if (!event.expiresAt || Date.parse(event.expiresAt) <= Date.parse(event.now)) return hold(s, "awaiting-input", "authorization-expired");
    return result({ ...s, phase: "awaiting-reservation", authorizationRef: event.authorizationRef, authorizationExpiresAt: event.expiresAt, revoked: false }, [{ ...bound(s), kind: "reserve-effect", decisionRef: s.decisionRef!, authorizationRef: event.authorizationRef }]);
  }
  if (event.kind === "reservation" && s.phase === "awaiting-reservation") {
    if (!event.reserved) return hold(s, "inconclusive", "reservation-unavailable");
    if (!event.reservationRef) return reject("invalid-input");
    if (s.revoked || Date.parse(s.authorizationExpiresAt!) <= Date.parse(event.now)) return hold(s, "awaiting-input", "authorization-expired");
    return result({ ...s, phase: "awaiting-dispatch", reservationRef: event.reservationRef }, [{
      ...bound(s), kind: "mediated-dispatch", decisionRef: s.decisionRef!, authorizationRef: s.authorizationRef!, reservationRef: event.reservationRef,
      recheckAtUse: true, checks: ["current-grant-intersection", "revocation", "data-and-destination-policy", "gpp-binding-revision", "exact-effect-binding", "single-use-reservation"],
    }]);
  }
  if (event.kind === "observation" && possiblySubmitted) {
    // Once an attempt has a proven terminal observation, accept neither duplicates nor a changed story.
    if (s.observation !== null && s.observation !== "unknown") return reject("unexpected-event");
    const r = event.receipt;
    if (!importTrustedArtifact(r, options).ok || !equalJson(r.binding, s.binding) || r.attemptId !== s.attemptId
      || !sameTrustedReference(r.decisionRef, s.decisionRef!) || !sameTrustedReference(r.authorizationRef, s.authorizationRef!)
      || Date.parse(r.recordedAt) > Date.parse(event.now)) return reject("invalid-receipt");
    s.observation = r.observation;
    const record: TrustedLoopCommand = { ...bound(s), kind: "record-outcome", receiptRef: r.sourceRef, observation: r.observation };
    if (r.observation === "succeeded") return result({ ...s, phase: "stopped", disposition: "proceed", reason: "effect-observed" }, [record]);
    if (r.observation === "unknown") {
      const next = reconcile(s);
      return next.ok ? { ...next, commands: [record, ...next.commands] } : next;
    }
    if (s.cancelled) {
      const stopped = hold(s, "awaiting-input", "work-cancelled");
      return stopped.ok ? { ...stopped, commands: [record, ...stopped.commands] } : stopped;
    }
    return result({ ...s, phase: "awaiting-reconciliation" }, [record]);
  }
  if (event.kind === "retry" && s.phase === "awaiting-reconciliation") {
    if (s.cancelled) return hold(s, "awaiting-input", "work-cancelled");
    if (!["no-effect", "not-submitted"].includes(s.observation ?? "") || s.usedAttemptIds.includes(event.nextAttemptId)) return reject("unexpected-event");
    if (s.attempts >= s.limits.attempts) return hold(s, "inconclusive", "attempt-budget-exhausted");
    if (expired(s, event.now)) return hold(s, "awaiting-input", "source-policy-expired");
    const next: TrustedLoopState = { ...s, phase: "awaiting-authorization", attempts: s.attempts + 1, attemptId: event.nextAttemptId, usedAttemptIds: [...s.usedAttemptIds, event.nextAttemptId], observation: null, authorizationRef: null, authorizationExpiresAt: null, reservationRef: null };
    return result(next, [{ ...bound(next), kind: "request-authorization", decisionRef: next.decisionRef! }]);
  }
  return reject("unexpected-event");
}

/** Malformed host objects, including throwing proxies, never escape as exceptions. */
export function createTrustedLoop(input: unknown, options: TrustedImportOptions = {}): TrustedLoopResult {
  try { return createLoop(input, options); } catch { return reject("invalid-input"); }
}
export function advanceTrustedLoop(input: unknown, event: unknown, options: TrustedImportOptions = {}): TrustedLoopResult {
  try { return advanceLoop(input, event, options); } catch { return reject("invalid-input"); }
}

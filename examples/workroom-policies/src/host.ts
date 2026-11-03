import {
  decideFundedAuthor, joinAutonomy, readScheduledWorkTrigger, resolveWorkPosture, temporalInputForTrigger,
  type ProactivityPlan,
} from "../kernel/workroom-policy/index.js";
import { startDriveMarking, stepDriveMarking, type DriveMarking } from "../kernel/workroom/index.js";
import { definition } from "./model.js";

export type Reference = { id: string; revision: string; digest: string };
export type TrustedFacts = {
  taskActive: boolean;
  taskRevision: string;
  authority: { reference: Reference; current: Reference; state: "current" | "revoked"; actorRef: string };
  funding: { reference: Reference; current: Reference; state: "current" | "revoked"; remaining: number } | null;
  availableSlots: number;
  inheritedPlan: ProactivityPlan;
};
export type Occurrence = { taskId: "synthetic-task"; revision: "1"; occurrence: string; taskConfig: unknown };
export type Observation = {
  attemptId: string; runKey: string; stageKey: "author"; iteration: number;
  actorRef: string; kind: "passing-test"; content: string;
};
type Attempt = {
  id: string; key: string; runKey: string; taskPayload: string; authority: Reference; funding: Reference;
  state: "working" | "completed" | "uncertain"; marking: DriveMarking;
};
type WakeResult = { status: "held"; reason: string } | { status: "prepared" | "replay"; attempt: Attempt };
const same = (a: Reference, b: Reference) => a.id === b.id && a.revision === b.revision && a.digest === b.digest;

/** Internal attempts contain only JSON records/scalars; callers receive no mutable store references. */
function attemptSnapshot(attempt: Attempt): Attempt {
  return JSON.parse(JSON.stringify(attempt)) as Attempt;
}

/** The facts are trusted test-harness inputs. This authenticates no caller or real source. */
function currentRefusal(task: Occurrence, facts: TrustedFacts): string | null {
  if (!facts.taskActive) return "cancelled";
  if (facts.taskRevision !== task.revision) return "stale-task";
  if (facts.authority.state !== "current") return "authority-revoked";
  if (!same(facts.authority.reference, facts.authority.current)) return "authority-stale";
  if (facts.authority.actorRef !== "agent:synthetic-author") return "actor-mismatch";
  if (!facts.funding) return "funding-missing";
  if (facts.funding.state !== "current" || !same(facts.funding.reference, facts.funding.current)) return "funding-stale";
  if (!Number.isFinite(facts.funding.remaining) || facts.funding.remaining < 1) return "budget-empty";
  return null;
}

/** Exact projection before the WK receipt boundary, including the run and iteration. */
export function exactObservation(attempt: { id: string; runKey: string; marking: DriveMarking }, observation: Observation): boolean {
  return observation.attemptId === attempt.id && observation.runKey === attempt.runKey
    && observation.stageKey === "author" && observation.iteration === (attempt.marking.iterations.author ?? 0)
    && observation.actorRef === "agent:synthetic-author" && observation.kind === "passing-test"
    && observation.content === "Exact synthetic observation";
}

/** Fixed in-memory protocol fixture. It has no cron service, financial ledger or tool executor. */
export class SyntheticPolicyHost {
  private readonly attempts = new Map<string, Attempt>();
  observations = 0;

  wake(task: Occurrence, facts: TrustedFacts, now: Date): WakeResult {
    const refusal = currentRefusal(task, facts);
    if (refusal) return { status: "held", reason: refusal };
    const trigger = readScheduledWorkTrigger(task.taskConfig);
    const posture = resolveWorkPosture({ inherited: { proactivityPlan: facts.inheritedPlan },
      temporal: temporalInputForTrigger(trigger, { now, schedule: null, timezone: "UTC" }) });
    if (joinAutonomy("autonomous-action", posture.actionBoundary).decisionMode !== "autonomous-action")
      return { status: "held", reason: "human-required" };
    const candidate = decideFundedAuthor({ applicable: true, role: "author", agentRef: facts.authority.actorRef,
      preauthorisation: { state: "in-force" }, funding: { funded: true, portfolioId: "synthetic-portfolio", summary: "Current synthetic funding supplied by the host." } });
    if (candidate.roleBindings.author !== "agent:synthetic-author") return { status: "held", reason: "author-withheld" };
    const key = `${task.taskId}:${task.occurrence}`;
    const existing = this.attempts.get(key);
    if (existing) {
      if (existing.taskPayload !== JSON.stringify(task)) return { status: "held", reason: "occurrence-conflict" };
      if (!same(existing.authority, facts.authority.reference) || !same(existing.funding, facts.funding!.reference))
        return { status: "held", reason: "changed-attempt-context" };
      if (existing.state === "uncertain") return { status: "held", reason: "effect-uncertain" };
      return { status: "replay", attempt: attemptSnapshot(existing) };
    }
    const inFlight = [...this.attempts.values()].filter(value => value.state !== "completed").length;
    if (!Number.isSafeInteger(facts.availableSlots) || facts.availableSlots <= inFlight) return { status: "held", reason: "capacity-held" };
    const attempt: Attempt = { id: `${key}:attempt:1`, key, runKey: key, taskPayload: JSON.stringify(task),
      authority: { ...facts.authority.reference }, funding: { ...facts.funding!.reference },
      state: "working", marking: startDriveMarking(definition, key, now) };
    this.attempts.set(key, attempt);
    return { status: "prepared", attempt: attemptSnapshot(attempt) };
  }

  complete(task: Occurrence, facts: TrustedFacts, observation: Observation, now: Date): { accepted: boolean; reason: string } {
    const refusal = currentRefusal(task, facts);
    if (refusal) return { accepted: false, reason: refusal };
    const attempt = this.attempts.get(`${task.taskId}:${task.occurrence}`);
    if (!attempt || !exactObservation(attempt, observation)) return { accepted: false, reason: "observation-mismatch" };
    if (attempt.taskPayload !== JSON.stringify(task)) return { accepted: false, reason: "occurrence-conflict" };
    if (!same(attempt.authority, facts.authority.reference) || !same(attempt.funding, facts.funding!.reference))
      return { accepted: false, reason: "changed-attempt-context" };
    if (attempt.state === "uncertain") return { accepted: false, reason: "effect-uncertain" };
    if (attempt.state === "completed") return { accepted: true, reason: "identical-replay" };
    const step = stepDriveMarking(definition, attempt.marking, { receipts: [observation] }, now);
    if (step.stopped?.kind !== "success") return { accepted: false, reason: "marking-held" };
    attempt.marking = step.marking;
    attempt.state = "completed";
    this.observations += 1;
    return { accepted: true, reason: "synthetic-observation-recorded" };
  }

  uncertain(task: Occurrence): void {
    const attempt = this.attempts.get(`${task.taskId}:${task.occurrence}`);
    if (attempt?.state === "working") attempt.state = "uncertain";
  }
}

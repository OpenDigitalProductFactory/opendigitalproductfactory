import {
  SCHEDULED_WORK_TRIGGER_KINDS, buildPostureProvenance, decideFundedAuthor, joinAutonomy,
  nextDriveHold, openDeadlines, raiseDueDeadlines, readScheduledWorkTrigger,
  resolveDelegatedPosture, resolveProactivityPlanForLevel, resolveTemporalBand, resolveWorkPosture,
  stallNoticeDue, temporalInputForTrigger, unnotifiedDeadlines, withDeadlinesNotified, withScheduledWorkTrigger,
  hasPassingVerificationEvidence, resolveVerificationRequirement,
  type ProactivityPlan, type WeeklySchedule, type WorkroomDriveHold,
} from "../kernel/workroom-policy/index.js";
import { startDriveMarking } from "../kernel/workroom/index.js";
import { SyntheticPolicyHost, exactObservation, type Observation, type Occurrence, type TrustedFacts } from "./host.js";
import { assert, definition, equal } from "./model.js";

const now = new Date("2026-10-20T03:00:00.000Z");
const reference = (id: string, revision = "1") => ({ id, revision, digest: `synthetic:${id}:${revision}` });
const inherited = (): ProactivityPlan => ({
  ...resolveProactivityPlanForLevel({ activityFamily: "scheduled-task", agentId: "synthetic-author" }, "balanced"),
  actionBoundary: "preauthorized", // Supplied host baseline, never inferred from a schedule.
});
function facts(): TrustedFacts {
  return { taskActive: true, taskRevision: "1", availableSlots: 1, inheritedPlan: inherited(),
    authority: { reference: reference("authority"), current: reference("authority"), state: "current", actorRef: "agent:synthetic-author" },
    funding: { reference: reference("funding"), current: reference("funding"), state: "current", remaining: 10 } };
}
function occurrence(value = "2026-10-20"): Occurrence {
  return { taskId: "synthetic-task", revision: "1", occurrence: value,
    taskConfig: withScheduledWorkTrigger({ fixture: true }, { kind: "time", workroomId: "synthetic-room",
      obligation: { dueAt: "2026-10-20T09:00:00.000Z", label: "Synthetic obligation" } }, now) };
}
function observation(attempt: { id: string; runKey: string }): Observation {
  return { attemptId: attempt.id, runKey: attempt.runKey, stageKey: "author", iteration: 0,
    actorRef: "agent:synthetic-author", kind: "passing-test", content: "Exact synthetic observation" };
}

export function runSmoke() {
  const passed: string[] = [];
  for (const kind of SCHEDULED_WORK_TRIGGER_KINDS) {
    const config = withScheduledWorkTrigger({ retained: 7 }, { kind }, now);
    assert(config.retained === 7 && readScheduledWorkTrigger(config)?.kind === kind, "trigger vocabulary round trip");
  }
  assert(readScheduledWorkTrigger({ trigger: { kind: "unknown" } }) === null, "unknown trigger cannot invent a source");
  assert(readScheduledWorkTrigger({ trigger: { kind: "time", obligation: { dueAt: "not-a-date" } } })?.obligation === null,
    "an unusable obligation is absent, not urgent authority");
  const open = { enabled: true, open: "09:00", close: "17:00" }, closed = { ...open, enabled: false };
  const schedule: WeeklySchedule = { monday: open, tuesday: open, wednesday: open, thursday: open,
    friday: open, saturday: closed, sunday: closed };
  const baseClock = { now, schedule, timezone: "UTC" };
  equal(resolveTemporalBand(baseClock).band, "out-of-hours", "trusted business clock resolves overnight time");
  const trigger = readScheduledWorkTrigger(occurrence().taskConfig);
  equal(resolveTemporalBand(temporalInputForTrigger(trigger, baseClock)).band, "pre-deadline", "obligation outranks the overnight band");
  assert(temporalInputForTrigger(null, baseClock) === baseClock, "missing trigger preserves the incumbent clock input");
  passed.push("trigger normalization and trusted-clock obligation precedence");

  const restrictive = { ...inherited(), actionBoundary: "advise" as const };
  const posture = resolveWorkPosture({ inherited: { proactivityPlan: restrictive },
    declaration: { proactivityLevel: "assertive", actionBoundary: "preauthorized" },
    hardPolicy: { verificationDepthFloor: "deep" } });
  equal(posture.actionBoundary, "advise", "a faster room declaration cannot widen the inherited boundary");
  equal(posture.verificationDepth, "deep", "hard verification floor remains in force");
  assert(buildPostureProvenance(posture).layers.some(layer => layer.layer === "hard-policy" && layer.contributed), "provenance carries the applied hard floor");
  equal(joinAutonomy("autonomous-action", posture.actionBoundary).decisionMode, "shadow-only", "stricter posture wins");
  equal(joinAutonomy("shadow-only", "preauthorized").decisionMode, "shadow-only", "a favorable posture cannot replace the envelope");
  equal(joinAutonomy("supervised-action", undefined).decisionMode, "supervised-action", "missing room posture preserves the incumbent envelope fallback");
  equal(resolveWorkPosture({ inherited: { proactivityPlan: inherited() } }).actionBoundary, "preauthorized", "absent room context supplies no new restriction");
  assert(resolveVerificationRequirement({ risk: "outbound-or-floor", verificationDepth: "none" }).required, "verification floor survives a shallow posture");
  assert(!hasPassingVerificationEvidence([{ status: "failed", completedAt: now }])
    && hasPassingVerificationEvidence([{ status: "passed", completedAt: now }]), "failed evidence does not satisfy verification");
  passed.push("tighten-only posture, stricter HITL join, provenance and verification requirements");

  const delegated = resolveDelegatedPosture({ caller: { agentId: "synthetic-caller", proactivityPlan: { ...inherited(), resolvedLevel: "assertive" } },
    receiver: { agentId: "synthetic-author", localProactivityPlan: { ...restrictive, resolvedLevel: "quiet" } } });
  assert(delegated.executionAllowed === true && delegated.proactivity.actionBoundary === "advise", "legacy executionAllowed is advisory metadata");
  const restrictedFacts = facts(); restrictedFacts.inheritedPlan = restrictive;
  equal(new SyntheticPolicyHost().wake(occurrence(), restrictedFacts, now), { status: "held", reason: "human-required" },
    "executionAllowed true does not bypass the host's stricter admission check");
  const candidateInput = { applicable: true, role: "author", agentRef: "agent:synthetic-author",
    preauthorisation: { state: "in-force" as const }, funding: { funded: true as const, portfolioId: "synthetic-portfolio", summary: "Host facts." } };
  equal(decideFundedAuthor(candidateInput).roleBindings, { author: "agent:synthetic-author" }, "current supplied conjunction proposes its exact role binding");
  equal(decideFundedAuthor({ ...candidateInput, preauthorisation: { state: "not-in-force", because: "Current operator withdrew it." } }).roleBindings, {}, "funding cannot replace current preauthorization");
  equal(decideFundedAuthor({ ...candidateInput, funding: { funded: false, because: "No current funded allowance." } }).roleBindings, {}, "preauthorization cannot replace funding");
  passed.push("delegation and author candidates remain separate from authority and funding admission");

  {
    const host = new SyntheticPolicyHost(), task = occurrence(), current = facts();
    const first = host.wake(task, current, now); assert(first.status === "prepared", "first recurring occurrence prepares");
    const duplicate = host.wake(task, current, now); assert(duplicate.status === "replay" && duplicate.attempt.id === first.attempt.id, "duplicate wake reuses one attempt");
    const changedPayload = { ...task, taskConfig: { trigger: { kind: "user-request" } } };
    equal(host.wake(changedPayload, current, now), { status: "held", reason: "occurrence-conflict" }, "changed payload cannot reuse the same occurrence identity");
    assert(!host.complete(changedPayload, current, observation(first.attempt), now).accepted, "changed occurrence payload cannot complete the prepared attempt");
    equal(host.observations, 0, "preparing and replaying do no observed work");
    assert(host.complete(task, current, observation(first.attempt), now).accepted, "exact current synthetic observation completes");
    assert(host.complete(task, current, observation(first.attempt), now).accepted, "identical acknowledgment replay returns its recorded result");
    equal(host.observations, 1, "lost acknowledgment replay never repeats the in-memory effect");
    const nextTask = occurrence("2026-10-21"), next = host.wake(nextTask, current, now);
    assert(next.status === "prepared" && next.attempt.runKey !== first.attempt.runKey, "next occurrence gets a distinct run");
    assert(!host.complete(nextTask, current, observation(first.attempt), now).accepted, "old run observation cannot complete a new occurrence");
    const nextIteration = { ...next.attempt, marking: { ...next.attempt.marking, iterations: { author: 1 } } };
    assert(!exactObservation(nextIteration, observation(next.attempt)), "old iteration cannot satisfy supplied current iteration");
    assert(exactObservation(nextIteration, { ...observation(next.attempt), iteration: 1 }), "exact current iteration remains distinguishable");
    assert(host.complete(nextTask, current, observation(next.attempt), now).accepted, "new occurrence consumes only its own observation");
    equal(host.observations, 2, "two distinct occurrences have two accepted observations");
  }
  passed.push("recurring occurrences, duplicate wakes, lost acknowledgment and exact run/iteration receipt projection");

  {
    const failures: string[] = [];
    for (const phase of ["prepared", "replay"] as const) {
      for (const target of ["state", "marking", "authority", "funding"] as const) {
        const host = new SyntheticPolicyHost(), task = occurrence(), current = facts();
        const prepared = host.wake(task, current, now);
        assert(prepared.status === "prepared", "mutation fixture prepares once");
        const receipt = observation(prepared.attempt);
        const returned = phase === "prepared" ? prepared : host.wake(task, current, now);
        assert(returned.status === phase, "mutation fixture selects the intended returned view");
        const view = returned.attempt;
        if (target === "state") view.state = "completed";
        if (target === "marking") view.marking.iterations.author = 99;
        if (target === "authority") view.authority.digest = "caller-mutated-authority";
        if (target === "funding") view.funding.revision = "caller-mutated-funding";
        const completed = host.complete(task, current, receipt, now);
        if (!completed.accepted || completed.reason !== "synthetic-observation-recorded" || host.observations !== 1)
          failures.push(`${phase}:${target}:${completed.reason}:observations=${host.observations}`);
      }
    }
    equal(failures, [], "caller mutations of prepared/replay views cannot change host-owned state, nested marking, authority or funding");
  }
  passed.push("prepared and replay projections are deep snapshots of private host custody");

  {
    const task = occurrence(), host = new SyntheticPolicyHost(), current = facts();
    const prepared = host.wake(task, current, now); assert(prepared.status === "prepared", "pending admission fixture");
    const cancelled = facts(); cancelled.taskActive = false;
    equal(host.wake(task, cancelled, now), { status: "held", reason: "cancelled" }, "cancelled task cannot reuse a prepared wake");
    assert(!host.complete(task, cancelled, observation(prepared.attempt), now).accepted, "cancellation before completion withholds acceptance");
    const revoked = facts(); revoked.authority.state = "revoked";
    equal(host.wake(task, revoked, now), { status: "held", reason: "authority-revoked" }, "revocation is checked before replay");
    assert(!host.complete(task, revoked, observation(prepared.attempt), now).accepted, "revoked pending attempt cannot complete");
    const stale = facts(); stale.authority.current = reference("authority", "2");
    equal(host.wake(task, stale, now), { status: "held", reason: "authority-stale" }, "old authority version does not supply current admission");
    const staleFunding = facts(); staleFunding.funding!.current = reference("funding", "2");
    assert(!host.complete(task, staleFunding, observation(prepared.attempt), now).accepted, "funding freshness is rechecked before completion");
    const changedTask = facts(); changedTask.taskRevision = "2";
    equal(host.wake(task, changedTask, now), { status: "held", reason: "stale-task" }, "changed task identity requires a new bounded admission");
    equal(host.observations, 0, "refused completion leaves the observation count unchanged");
  }
  passed.push("cancellation, current revocation, stale authority and changed task revision hold before replay/completion");

  {
    const task = occurrence(), host = new SyntheticPolicyHost();
    const missing = facts(); missing.funding = null;
    equal(host.wake(task, missing, now), { status: "held", reason: "funding-missing" }, "funding has no favorable default");
    const stale = facts(); stale.funding!.current = reference("funding", "2");
    equal(host.wake(task, stale, now), { status: "held", reason: "funding-stale" }, "stale funding is held separately");
    const empty = facts(); empty.funding!.remaining = 0;
    equal(host.wake(task, empty, now), { status: "held", reason: "budget-empty" }, "capacity cannot purchase an absent budget");
    const busy = facts(); busy.availableSlots = 0;
    equal(host.wake(task, busy, now), { status: "held", reason: "capacity-held" }, "a funded occurrence still waits for capacity");
    assert(host.wake(task, facts(), now).status === "prepared", "returned capacity allows the same still-current occurrence");
    equal(host.wake(occurrence("2026-10-21"), facts(), now), { status: "held", reason: "capacity-held" }, "a pending attempt occupies the fixture's one slot");
  }
  passed.push("missing/stale funding, empty budget and unavailable capacity remain distinct holds");

  {
    const host = new SyntheticPolicyHost(), task = occurrence(), current = facts();
    const first = host.wake(task, current, now); assert(first.status === "prepared", "uncertain fixture begins once");
    host.uncertain(task);
    current.availableSlots = 10;
    equal(host.wake(task, current, now), { status: "held", reason: "effect-uncertain" }, "more capacity never replays an original uncertain effect");
    assert(!host.complete(task, current, observation(first.attempt), now).accepted, "a bare receipt cannot settle the fixture's uncertain attempt");
    equal(host.observations, 0, "uncertainty is neither completion nor another attempt");
  }
  passed.push("original uncertain attempt retains its hold despite favorable capacity and a supplied receipt");

  {
    const original = startDriveMarking(definition, "synthetic-run#one", now), before = JSON.stringify(original);
    equal(raiseDueDeadlines(definition, original, new Date(now.getTime() + 86_400_000 - 1)).raised.length, 0, "deadline has an exact lower boundary");
    const dueAt = new Date(now.getTime() + 86_400_000), due = raiseDueDeadlines(definition, original, dueAt);
    equal(JSON.stringify(original), before, "raising a deadline leaves its input unchanged");
    equal([due.marking.tokens, due.marking.iterations, due.marking.reworkTaken], [original.tokens, original.iterations, original.reworkTaken], "deadline cannot advance or rework tokens");
    equal([due.raised.length, openDeadlines(definition, due.marking).length], [1, 1], "one open notice per exact stage pass");
    equal(raiseDueDeadlines(definition, due.marking, dueAt).raised.length, 0, "duplicate wake never raises the same notice twice");
    let stored = due.marking, sends = 0;
    const deliver = (acknowledged: boolean) => {
      const pending = unnotifiedDeadlines(definition, stored); sends += pending.length;
      if (acknowledged) stored = withDeadlinesNotified(stored, pending.map(notice => notice.key), dueAt);
    };
    deliver(false); deliver(true); deliver(true);
    equal(sends, 2, "lost delivery acknowledgment permits at-least-once resend, never an exactly-once claim");
    equal(unnotifiedDeadlines(definition, stored), [], "confirmed notice is not sent again");
    equal(stored.tokens, original.tokens, "delivery bookkeeping never completes the stage");
    equal(openDeadlines(definition, { ...stored, iterations: { author: 1 } }), [], "previous iteration notice does not describe the new pass");
  }
  passed.push("deadline identity, immutability, duplicate suppression and lost acknowledgment at-least-once bookkeeping");

  {
    let hold: WorkroomDriveHold | null = null;
    for (let index = 0; index < 4; index += 1) hold = nextDriveHold(hold,
      { action: index % 2 ? "escalate" : "pause", reason: "synthetic-wait", stageKey: "author", conformance: null },
      new Date(now.getTime() + index * 900_000));
    assert(hold && stallNoticeDue(hold), "mixed pause/escalate spell reaches its shared four-tick threshold");
    assert(stallNoticeDue(hold), "lost notification acknowledgment leaves the notice due");
    assert(!stallNoticeDue({ ...hold, notifiedAt: now.toISOString() }), "recorded delivery acknowledgment suppresses repeat");
    const advancing = nextDriveHold(hold, { action: "dispatch_agent", reason: "synthetic-observation", stageKey: "author", conformance: null }, now);
    assert(advancing.stuckTicks === 0 && !stallNoticeDue(advancing), "advancement clears the stuck spell rather than counting lifetime pauses");
  }
  passed.push("stall attention threshold, acknowledgment retry and recovery reset");

  return { passed, qualification: "Synthetic policies and fixed local host protocol only; no production authorization, budget reservation, scheduler, effect execution, database concurrency or browser/runtime qualification.",
    incumbentLimits: ["Missing DPF room context retains the inherited plan.", "DPF dispatch lanes still floor at one slot; this fixture's zero-capacity hold is an independent host rule.",
      "Delegated executionAllowed remains advisory metadata.", "The host must establish current authority/funding and protect observations; portable policies authenticate nothing."] };
}

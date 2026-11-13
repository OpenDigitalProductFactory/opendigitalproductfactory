import { describe, expect, it } from "vitest";

import {
  ESCALATION_RECHECK_MS,
  MAX_UNKNOWN_OBSERVATIONS,
  consecutiveUnknownObservations,
  isDeliveryObservationDue,
  nextUnknownObservation,
  resumeClearedEscalation,
} from "./build-pr-delivery-recheck";
import { decideBuildPrDeliveryAction } from "./build-pr-delivery-reconciler";
import { createBuildPrDeliveryState, readBuildPrDeliveryState, type BuildPrDeliveryStateV1 } from "./build-pr-delivery-state";

const HEAD = "d38a3c56ecbff59bcaae05edc7cde7ec7b67e54e";
const base = createBuildPrDeliveryState({ repository: "o/r", prNumber: 6983, prUrl: "https://github.com/o/r/pull/6983" });
const now = new Date("2026-11-13T18:00:00Z");

// The record WC-8B8A9D6F held from 08:02Z on 2026-11-13 (BI-0EDCF2EC), as stored.
const stopped6983 = readBuildPrDeliveryState({
  prDelivery: {
    prUrl: "https://github.com/o/r/pull/6983", status: "escalated", prNumber: 6983,
    lastError: "observation-budget-exhausted:merge-state-unknown", repository: "o/r",
    escalationKey: "build-pr-delivery:6983:observation-budget-exhausted:merge-state-unknown",
    followThrough: { hold: null, failing: [], attempts: { attempts: {}, policyVersion: "autonomous-build-recovery/v1", schemaVersion: 1, emittedEscalationKeys: [] }, infraReruns: null, attentionKey: null, judgedHeadSha: null },
    lastReadiness: "unknown", schemaVersion: 1, lastObservedAt: "2026-11-13T08:02:06.317Z",
    lastActuatedHeadSha: null, lastObservedHeadSha: HEAD, staleUpdateAttempts: 0, reconciliationAttempts: 8,
  },
})!;

describe("consecutive unknown observations (BI-0EDCF2EC AC-1)", () => {
  it("counts only unknown observations of the same head in a row", () => {
    expect(consecutiveUnknownObservations({ ...base, reconciliationAttempts: 8, lastReadiness: "checking" }, HEAD)).toBe(0);
    expect(consecutiveUnknownObservations({ ...base, lastReadiness: "unknown", lastObservedHeadSha: HEAD, unknownObservations: 3 }, HEAD)).toBe(3);
    expect(consecutiveUnknownObservations({ ...base, lastReadiness: "unknown", lastObservedHeadSha: "other", unknownObservations: 3 }, HEAD)).toBe(0);
  });

  it("observes at the normal cadence within the budget, then backs off to at most an hour", () => {
    const first = nextUnknownObservation({ ...base, reconciliationAttempts: 40 }, HEAD, now);
    expect(first).toEqual({ unknownObservations: 1, nextObservationAt: null });
    const atBudget = nextUnknownObservation({ ...base, lastReadiness: "unknown", lastObservedHeadSha: HEAD, unknownObservations: MAX_UNKNOWN_OBSERVATIONS - 1 }, HEAD, now);
    expect(atBudget.unknownObservations).toBe(MAX_UNKNOWN_OBSERVATIONS);
    expect(Date.parse(atBudget.nextObservationAt!) - now.getTime()).toBe(10 * 60 * 1000);
    const late = nextUnknownObservation({ ...base, lastReadiness: "unknown", lastObservedHeadSha: HEAD, unknownObservations: 40 }, HEAD, now);
    expect(Date.parse(late.nextObservationAt!) - now.getTime()).toBe(60 * 60 * 1000);
  });

  it("never escalates a merge state GitHub has not decided, however many times it was observed", () => {
    const action = decideBuildPrDeliveryAction({
      state: { ...base, reconciliationAttempts: 8, lastReadiness: "unknown", lastObservedHeadSha: HEAD, unknownObservations: 30 },
      readiness: { kind: "unknown", headSha: HEAD, reason: "merge-state-unknown" },
    });
    expect(action).toEqual({ kind: "wait", status: "checking", headSha: HEAD, reason: "observation-deferred:merge-state-unknown" });
  });
});

describe("re-evaluating an escalated room (BI-0EDCF2EC AC-2)", () => {
  it("resumes PR #6983's observation-budget stop and queues once GitHub reports a decisive state", () => {
    const resumed = resumeClearedEscalation(stopped6983, { kind: "ready", headSha: HEAD });
    expect(resumed.kind).toBe("cleared");
    if (resumed.kind !== "cleared") return;
    expect(resumed.state).toMatchObject({ status: "checking", escalationKey: null, lastError: null, unknownObservations: 0, nextObservationAt: null });
    expect(decideBuildPrDeliveryAction({ state: resumed.state, readiness: { kind: "ready", headSha: HEAD } }))
      .toEqual({ kind: "queue", headSha: HEAD });
  });

  it("resumes an observation-budget stop even while GitHub is still undecided, under the bounded backoff", () => {
    const resumed = resumeClearedEscalation(stopped6983, { kind: "unknown", headSha: HEAD, reason: "merge-state-unknown" });
    expect(resumed.kind).toBe("cleared");
  });

  it("keeps a conflict or exhausted update stop while the condition holds and lifts it once it clears", () => {
    const conflict: BuildPrDeliveryStateV1 = { ...base, status: "escalated", lastError: "true-merge-conflict", escalationKey: "k" };
    expect(resumeClearedEscalation(conflict, { kind: "conflict", headSha: HEAD }).kind).toBe("holds");
    expect(resumeClearedEscalation(conflict, { kind: "checking", headSha: HEAD, reason: "checks-pending" }).kind).toBe("cleared");
    const stale: BuildPrDeliveryStateV1 = { ...base, status: "escalated", lastError: "stale-update-budget-exhausted", escalationKey: "k", staleUpdateAttempts: 2 };
    expect(resumeClearedEscalation(stale, { kind: "behind", headSha: HEAD }).kind).toBe("holds");
    const cleared = resumeClearedEscalation(stale, { kind: "ready", headSha: HEAD });
    expect(cleared.kind === "cleared" && cleared.state.staleUpdateAttempts).toBe(0);
  });

  it("leaves stops that need a person, and rooms that are not stopped, alone", () => {
    expect(resumeClearedEscalation({ ...base, status: "escalated", lastError: "local-evidence-not-cleared" }, { kind: "ready", headSha: HEAD }).kind).toBe("not-reevaluable");
    expect(resumeClearedEscalation({ ...base, status: "escalated", lastError: "autonomous-eligibility-withheld" }, { kind: "ready", headSha: HEAD }).kind).toBe("not-reevaluable");
    expect(resumeClearedEscalation({ ...base, status: "checking" }, { kind: "ready", headSha: HEAD }).kind).toBe("not-escalated");
  });
});

describe("isDeliveryObservationDue", () => {
  it("re-observes a re-evaluable stop no more than every recheck interval", () => {
    expect(isDeliveryObservationDue(stopped6983, now)).toBe(true);
    const recent = { ...stopped6983, lastObservedAt: new Date(now.getTime() - ESCALATION_RECHECK_MS + 1000).toISOString() };
    expect(isDeliveryObservationDue(recent, now)).toBe(false);
    expect(isDeliveryObservationDue({ ...stopped6983, lastError: "local-evidence-not-cleared" }, now)).toBe(false);
  });

  it("honours a backoff and never re-observes a closed or deployed PR", () => {
    expect(isDeliveryObservationDue({ ...base, status: "checking", nextObservationAt: new Date(now.getTime() + 1000).toISOString() }, now)).toBe(false);
    expect(isDeliveryObservationDue({ ...base, status: "checking", nextObservationAt: new Date(now.getTime() - 1000).toISOString() }, now)).toBe(true);
    expect(isDeliveryObservationDue({ ...base, status: "closed" }, now)).toBe(false);
    expect(isDeliveryObservationDue({ ...base, status: "deployed" }, now)).toBe(false);
    expect(isDeliveryObservationDue(null, now)).toBe(true);
  });
});

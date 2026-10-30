import { describe, expect, it, vi } from "vitest";

import type { InitiativeReadinessDecision, ReadinessVerdict } from "@/lib/backlog/initiative-readiness/types";

import type { AcceptanceSweepPageItem } from "./acceptance-sweep-page";
import { runAcceptanceSweep, type AcceptanceSweepPorts, type SweepEvaluation } from "./acceptance-sweep-run";
import type { CloseAuthorisation } from "./close-authorisation";

// BI-45D3BBF4: the sweep closes items whose completion verdict is already
// "allowed", through the terminal transition, only under a recorded operator
// pre-authorisation, and at most `limit` per run (AC-1..AC-4).

const NOW = new Date("2026-10-06T05:00:00.000Z");
const CONFIG = { pageSize: 10, agedDays: 14, trendDays: 30, routing: false, routeLimit: 10, recordedByAgentId: "AGT-WS-PORTFOLIO" };

const ENABLED: CloseAuthorisation = {
  state: "enabled",
  setByUserId: "user-operator",
  setAt: "2026-10-01T09:00:00.000Z",
  reason: "Operator pre-authorised closing items the gate allows (BI-8A32EBFF).",
  limit: 25,
  agentGrant: "backlog_write",
};

function item(id: string): AcceptanceSweepPageItem {
  return { id, itemId: `BI-${id.toUpperCase()}`, claimedByAgentId: null, agentId: null };
}

function decision(verdict: ReadinessVerdict, extra: Partial<InitiativeReadinessDecision> = {}): InitiativeReadinessDecision {
  return {
    decisionId: `IRD-${verdict}`,
    policyVersion: "initiative-readiness.v3",
    subject: { kind: "backlog-item", id: "BI-X" },
    transitionObject: { kind: "backlog-item", id: "BI-X", expectedVersion: "read-projection", targetState: "completion" },
    profile: "feature",
    target: "completion",
    verdict,
    satisfied: [],
    unmet: [],
    blockers: [],
    evaluatedAt: NOW.toISOString(),
    ...extra,
  } as InitiativeReadinessDecision;
}

function evaluation(verdict: ReadinessVerdict, closable = verdict === "allowed", extra: Partial<InitiativeReadinessDecision> = {}): SweepEvaluation {
  return { owed: [], owner: null, unroutable: [], closable, decision: decision(verdict, extra) };
}

function ports(
  evaluations: Record<string, SweepEvaluation | null>,
  overrides: Partial<AcceptanceSweepPorts> = {},
): AcceptanceSweepPorts {
  const ids = Object.keys(evaluations);
  return {
    now: NOW,
    loadPoolAges: async () => new Map(),
    loadLastCursor: async () => null,
    selectPage: async () => ({ items: ids.map(item), unsnapshotted: ids.length, nextCursor: null }),
    evaluate: async (entry) => evaluations[entry.id] ?? null,
    recordSnapshot: async () => ({ written: false }),
    recordRun: async () => ({ activityId: "run-1" }),
    resolveCloseAuthorisation: async () => ENABLED,
    close: vi.fn(async () => ({ outcome: "closed" as const, authorityDecisionId: "DI-1" })),
    route: vi.fn(async () => []),
    ...overrides,
  };
}

describe("runAcceptanceSweep — closing under the operator pre-authorisation", () => {
  it("closes an allowed item through the close port, with the decision and the authorisation in force", async () => {
    const p = ports({ a: evaluation("allowed") });
    const summary = await runAcceptanceSweep(p, CONFIG);

    expect(p.close).toHaveBeenCalledTimes(1);
    expect(p.close).toHaveBeenCalledWith(item("a"), expect.objectContaining({ verdict: "allowed", decisionId: "IRD-allowed" }), ENABLED);
    expect(summary.closing).toMatchObject({
      enabled: true,
      disabledReason: null,
      authorisedBy: { userId: "user-operator", at: "2026-10-01T09:00:00.000Z" },
      attempted: 1,
      closed: ["BI-A"],
    });
    expect(summary.headline).toContain("1 closed under operator pre-authorisation");
  });

  it("never closes input-required, denied (blocked) or signal-unavailable items", async () => {
    const signalUnavailable = evaluation("input-required", false, {
      unmet: [{
        code: "DELIVERY_EVIDENCE_REQUIRED",
        state: "missing",
        accountableRole: "delivery-coordinator",
        evidenceRefs: [],
        evidenceLane: "none",
        unreadEvidenceRefs: [],
        nextAction: "The merge signal could not run on this runtime.",
      } as InitiativeReadinessDecision["unmet"][number]],
    });
    const p = ports({
      a: evaluation("input-required"),
      b: evaluation("denied"),
      c: signalUnavailable,
      d: null,
    });
    const summary = await runAcceptanceSweep(p, CONFIG);
    expect(p.close).not.toHaveBeenCalled();
    expect(summary.closing.closed).toEqual([]);
    expect(summary.closing.attempted).toBe(0);
    expect(summary.items.readinessUnavailable).toEqual(["BI-D"]);
  });

  it("does not close when a projection reads closable but its decision is anything other than allowed", async () => {
    const p = ports({ a: evaluation("input-required", true), b: { owed: [], owner: null, unroutable: [], closable: true } });
    const summary = await runAcceptanceSweep(p, CONFIG);
    expect(p.close).not.toHaveBeenCalled();
    expect(summary.closing.closed).toEqual([]);
  });

  it.each([
    ["not-recorded", "No operator pre-authorisation is recorded."],
    ["revoked", "The pre-authorisation was revoked by user-operator."],
    ["operator-not-authorised", "The operator no longer holds manage_backlog."],
    ["agent-not-granted", "AGT-WS-PORTFOLIO holds no completion grant."],
  ] as const)("closes nothing when the authorisation is %s, and the summary says why", async (reason, because) => {
    const p = ports({ a: evaluation("allowed"), b: evaluation("allowed") }, {
      resolveCloseAuthorisation: async () => ({ state: "disabled", reason, because }),
    });
    const summary = await runAcceptanceSweep(p, CONFIG);
    expect(p.close).not.toHaveBeenCalled();
    expect(summary.page.closable).toBe(2);
    expect(summary.closing).toMatchObject({ enabled: false, disabledReason: reason, because, closed: [], limit: 0 });
    expect(summary.headline).toContain(`closing off (${reason})`);
  });

  it("closes nothing when the authorisation cannot be read", async () => {
    const p = ports({ a: evaluation("allowed") }, {
      resolveCloseAuthorisation: async () => { throw new Error("config store down"); },
    });
    const summary = await runAcceptanceSweep(p, CONFIG);
    expect(p.close).not.toHaveBeenCalled();
    expect(summary.closing).toMatchObject({ enabled: false, disabledReason: "unavailable" });
    expect(summary.closing.because).toContain("config store down");
  });

  it("respects the per-run bound and reports what it left for a later run", async () => {
    const p = ports(
      { a: evaluation("allowed"), b: evaluation("allowed"), c: evaluation("allowed") },
      { resolveCloseAuthorisation: async () => ({ ...ENABLED, limit: 2 }) },
    );
    const summary = await runAcceptanceSweep(p, CONFIG);
    expect(p.close).toHaveBeenCalledTimes(2);
    expect(summary.closing).toMatchObject({ limit: 2, attempted: 2, closed: ["BI-A", "BI-B"], deferredByLimit: ["BI-C"] });
  });

  it("never closes more than the page, even under a larger bound", async () => {
    const p = ports({ a: evaluation("allowed") });
    const summary = await runAcceptanceSweep(p, { ...CONFIG, pageSize: 1 });
    expect(summary.closing.limit).toBe(1);
  });

  it("records refusals, skips and errors without stopping the run", async () => {
    const close = vi.fn(async (entry: AcceptanceSweepPageItem) => {
      if (entry.id === "a") return { outcome: "refused" as const, code: "STALE_EVIDENCE", authorityDecisionId: "DI-2" };
      if (entry.id === "b") return { outcome: "skipped" as const, reason: "status-changed" as const };
      if (entry.id === "c") throw new Error("transaction aborted");
      return { outcome: "closed" as const, authorityDecisionId: "DI-3" };
    });
    const p = ports({ a: evaluation("allowed"), b: evaluation("allowed"), c: evaluation("allowed"), d: evaluation("allowed") }, { close });
    const summary = await runAcceptanceSweep(p, CONFIG);
    expect(summary.closing).toMatchObject({
      attempted: 4,
      closed: ["BI-D"],
      refused: [{ itemId: "BI-A", code: "STALE_EVIDENCE" }],
      skipped: [{ itemId: "BI-B", reason: "status-changed" }],
      errored: [{ itemId: "BI-C", message: "transaction aborted" }],
    });
  });
});

// BI-C899BB40 (AC-CFD-3): under the new rule a merged item reads allowed, so
// the sweep drains the pool at the default bound of 100 per run; an item with
// no delivery evidence still reads input-required and is never touched.
describe("runAcceptanceSweep — draining delivered work (BI-C899BB40)", () => {
  it("closes delivered items up to the default bound and leaves undelivered ones alone", async () => {
    const { DEFAULT_CLOSE_LIMIT } = await import("./close-authorisation");
    expect(DEFAULT_CLOSE_LIMIT).toBe(100);
    const evaluations: Record<string, SweepEvaluation | null> = {};
    for (let i = 0; i < 110; i++) evaluations[`d${String(i).padStart(3, "0")}`] = evaluation("allowed");
    for (let i = 0; i < 5; i++) evaluations[`u${i}`] = evaluation("input-required", false, { unmet: [{
      code: "DELIVERY_EVIDENCE_REQUIRED", state: "missing", accountableRole: "delivery-coordinator", evidenceRefs: [],
      evidenceLane: "none", unreadEvidenceRefs: [], nextAction: null } as InitiativeReadinessDecision["unmet"][number]] });
    const p = ports(evaluations, { resolveCloseAuthorisation: async () => ({ ...ENABLED, limit: DEFAULT_CLOSE_LIMIT }) });
    const summary = await runAcceptanceSweep(p, { ...CONFIG, pageSize: 200 });
    expect(p.close).toHaveBeenCalledTimes(100);
    expect(summary.closing.closed).toHaveLength(100);
    expect(summary.closing.deferredByLimit).toHaveLength(10);
    const closedOrDeferred = new Set([...summary.closing.closed, ...summary.closing.deferredByLimit]);
    for (let i = 0; i < 5; i++) expect(closedOrDeferred.has(`BI-U${i}`)).toBe(false);
  });
});

// BI-C899BB40 (AC-CFD-1, AC-CFD-2): a done item is never re-evaluated for
// acceptance; its one bounded step goes to the confirmation lane.
describe("runAcceptanceSweep — done items take their one bounded step", () => {
  it("sends a done item to confirm, never to evaluate or close, and reports the step", async () => {
    const done = { ...item("x"), status: "done" };
    const evaluate = vi.fn(async () => evaluation("allowed"));
    const confirm = vi.fn(async () => ({ step: "question-not-sent" as const, reason: "no-credential" }));
    const p = ports({}, {
      selectPage: async () => ({ items: [done, { ...item("y"), status: "done" }], unsnapshotted: 0, nextCursor: null }),
      evaluate, confirm: vi.fn()
        .mockImplementationOnce(confirm)
        .mockImplementationOnce(async () => ({ step: "not-fixed" as const, correctiveItemId: "BI-ACC-1" })),
    });
    const summary = await runAcceptanceSweep(p, CONFIG);
    expect(evaluate).not.toHaveBeenCalled();
    expect(p.close).not.toHaveBeenCalled();
    expect(summary.confirmation).toEqual({ visited: 2, steps: { "question-not-sent": 1, "not-fixed": 1 },
      notSentByReason: { "no-credential": 1 }, correctiveItemIds: ["BI-ACC-1"], errored: [] });
  });

  it("records a failed step and keeps going", async () => {
    const p = ports({ a: evaluation("allowed") }, {
      selectPage: async () => ({ items: [{ ...item("x"), status: "done" }, item("a")], unsnapshotted: 0, nextCursor: null }),
      confirm: vi.fn(async () => { throw new Error("github down"); }),
    });
    const summary = await runAcceptanceSweep(p, CONFIG);
    expect(summary.confirmation.errored).toEqual([{ itemId: "BI-X", message: "github down" }]);
    expect(summary.closing.closed).toEqual(["BI-A"]);
  });
});

import { describe, expect, it, vi } from "vitest";

import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness/types";

import type { AcceptancePoolAge } from "./acceptance-pool-age";
import type { AcceptanceSweepPageItem } from "./acceptance-sweep-page";
import { runAcceptanceSweep, type AcceptanceSweepPorts, type SweepEvaluation } from "./acceptance-sweep-run";
import type { AgedSweepCandidate } from "./acceptance-sweep-routing";
import type { CloseAuthorisation } from "./close-authorisation";
import type { RouteOutcome } from "./route-aged-item";

// BI-C1781121 (design §3.3 step 4, §3.4): with routing on, the run hands its
// aged, evaluated, non-closable items to the route port with the configured
// limit and reports each outcome. Closable items are left to the close step
// (BI-45D3BBF4), so no item is both closed and routed.

const NOW = new Date("2026-10-07T05:00:00.000Z");
const CONFIG = { pageSize: 10, agedDays: 14, trendDays: 30, routing: true, routeLimit: 2, recordedByAgentId: "AGT-WS-PORTFOLIO" };

function item(id: string): AcceptanceSweepPageItem {
  return { id, itemId: `BI-${id.toUpperCase()}`, claimedByAgentId: null, agentId: null };
}

function age(id: string, ageDays: number): AcceptancePoolAge {
  return { rowId: id, itemId: `BI-${id.toUpperCase()}`, enteredAt: new Date(NOW.getTime() - ageDays * 86_400_000), ageBasis: "entry", ageDays };
}

const owed: SweepEvaluation = {
  owed: [{ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer", nextAction: "map" }],
  owner: { agentId: "AGT-WS-BUILD", displayName: "Build", codes: ["ACCEPTANCE_EVIDENCE_REQUIRED"] },
  unroutable: [],
  closable: false,
};

const allowed = {
  decisionId: "IRD-allowed",
  policyVersion: "initiative-readiness.v3",
  subject: { kind: "backlog-item", id: "BI-CLOSE" },
  transitionObject: { kind: "backlog-item", id: "BI-CLOSE", expectedVersion: "read-projection", targetState: "completion" },
  profile: "feature",
  target: "completion",
  verdict: "allowed",
  satisfied: [],
  unmet: [],
  blockers: [],
  evaluatedAt: NOW.toISOString(),
} as unknown as InitiativeReadinessDecision;
const closable: SweepEvaluation = { owed: [], owner: null, unroutable: [], closable: true, decision: allowed };

const ENABLED: CloseAuthorisation = {
  state: "enabled",
  setByUserId: "user-operator",
  setAt: "2026-10-01T09:00:00.000Z",
  reason: "Operator pre-authorised closing items the gate allows.",
  limit: 25,
  agentGrant: "backlog_write",
};

function ports(overrides: Partial<AcceptanceSweepPorts> = {}): AcceptanceSweepPorts {
  const evaluations: Record<string, SweepEvaluation> = { old: owed, mid: owed, young: owed, close: closable };
  const ages: Record<string, number> = { old: 90, mid: 40, young: 5, close: 60 };
  return {
    now: NOW,
    loadPoolAges: async () => new Map(Object.entries(ages).map(([id, days]) => [id, age(id, days)])),
    loadLastCursor: async () => null,
    selectPage: async () => ({ items: Object.keys(evaluations).map(item), unsnapshotted: 4, nextCursor: null }),
    evaluate: async (entry) => evaluations[entry.id] ?? null,
    recordSnapshot: async () => ({ written: false }),
    recordRun: async () => ({ activityId: "run-1" }),
    resolveCloseAuthorisation: async () => ({ state: "disabled", reason: "not-recorded", because: "none recorded" }),
    close: vi.fn(async () => ({ outcome: "closed" as const, authorityDecisionId: "DI-1" })),
    route: vi.fn(async (candidates: readonly AgedSweepCandidate[]): Promise<RouteOutcome[]> =>
      candidates.map((candidate, index) => ({
        itemId: candidate.item.itemId,
        ageDays: candidate.ageDays,
        outcome: index === 0 ? "routed" : "deferred",
        capsuleId: index === 0 ? `WC-ACC-${candidate.item.id.toUpperCase()}` : null,
        ownerAgentId: candidate.projection.owner?.agentId ?? null,
        reason: null,
      }))),
    ...overrides,
  };
}

describe("runAcceptanceSweep — routing aged items (BI-C1781121)", () => {
  it("hands only the aged, non-closable page items to the route port, with the configured limit", async () => {
    const p = ports();
    const summary = await runAcceptanceSweep(p, CONFIG);

    expect(p.route).toHaveBeenCalledTimes(1);
    const [candidates, limit] = vi.mocked(p.route).mock.calls[0]!;
    expect(candidates.map((candidate) => [candidate.item.itemId, candidate.ageDays])).toEqual([["BI-OLD", 90], ["BI-MID", 40]]);
    expect(candidates[0]!.projection).toBe(owed);
    expect(limit).toBe(2);
    expect(summary.routing).toMatchObject({ enabled: true, routeLimit: 2, candidates: 2, routed: 1, deferred: 1, unroutable: 0, error: null });
    expect(summary.routing.rooms.map((room) => [room.itemId, room.outcome, room.capsuleId])).toEqual([
      ["BI-OLD", "routed", "WC-ACC-OLD"],
      ["BI-MID", "deferred", null],
    ]);
    expect(summary.headline).toContain("routing: 1 routed, 0 already routed, 0 routed-unresolved, 0 unroutable, 1 deferred past the limit of 2");
  });

  it("closes a closable aged item under the pre-authorisation and never routes it", async () => {
    const p = ports({ resolveCloseAuthorisation: async () => ENABLED });
    const summary = await runAcceptanceSweep(p, CONFIG);

    expect(summary.closing.closed).toEqual(["BI-CLOSE"]);
    const [candidates] = vi.mocked(p.route).mock.calls[0]!;
    expect(candidates.map((candidate) => candidate.item.itemId)).not.toContain("BI-CLOSE");
  });

  it("does not route a closable item without the pre-authorisation either: it is reported closable, not routed", async () => {
    const p = ports();
    const summary = await runAcceptanceSweep(p, CONFIG);
    expect(summary.items.closable).toEqual(["BI-CLOSE"]);
    expect(summary.routing.rooms.map((room) => room.itemId)).not.toContain("BI-CLOSE");
  });

  it("counts unroutable outcomes by each reason code", async () => {
    const p = ports({
      route: vi.fn(async (candidates: readonly AgedSweepCandidate[]) => candidates.map((candidate) => ({
        itemId: candidate.item.itemId, ageDays: candidate.ageDays, outcome: "unroutable" as const,
        capsuleId: null, ownerAgentId: null, reason: "no-in-platform-coworker, workroom-not-found",
      }))),
    });
    const summary = await runAcceptanceSweep(p, CONFIG);
    expect(summary.routing).toMatchObject({ unroutable: 2, unroutableByReason: { "no-in-platform-coworker": 2, "workroom-not-found": 2 } });
  });

  it("records a routing failure in the summary and still records the run", async () => {
    const recordRun = vi.fn(async () => ({ activityId: "run-1" }));
    const p = ports({ recordRun, route: vi.fn(async () => { throw new Error("workroom table locked"); }) });
    const summary = await runAcceptanceSweep(p, CONFIG);
    expect(recordRun).toHaveBeenCalledTimes(1);
    expect(summary.routing).toMatchObject({ enabled: true, routed: 0, error: "workroom table locked" });
    expect(summary.headline).toContain("routing failed (workroom table locked)");
  });

  it("does not call the route port when no page item is aged", async () => {
    const p = ports({ loadPoolAges: async () => new Map([["old", age("old", 3)], ["mid", age("mid", 3)]]) });
    const summary = await runAcceptanceSweep(p, CONFIG);
    expect(p.route).not.toHaveBeenCalled();
    expect(summary.routing).toMatchObject({ enabled: true, candidates: 0, routed: 0 });
  });
});

describe("runAcceptanceSweep — objective-mapping packets issued to routed rooms (BI-099A0BA3)", () => {
  it("counts each room's packet outcome and names the issued count in the headline", async () => {
    const outcomes = ["issued", "current", "not-issuable"] as const;
    const p = ports({
      loadPoolAges: async () => new Map([["old", age("old", 90)], ["mid", age("mid", 40)], ["young", age("young", 20)]]),
      route: vi.fn(async (candidates: readonly AgedSweepCandidate[]) => candidates.map((candidate, index) => ({
        itemId: candidate.item.itemId, ageDays: candidate.ageDays, outcome: "already-routed" as const,
        capsuleId: `WC-ACC-${candidate.item.id.toUpperCase()}`, ownerAgentId: "AGT-WS-BUILD", reason: null,
        objectiveMapping: outcomes[index] ?? null,
      }))),
    });
    const summary = await runAcceptanceSweep(p, CONFIG);

    expect(summary.routing.objectiveMapping).toEqual({ issued: 1, current: 1, withdrawn: 0, shapeOutdated: 0, noLiveRoom: 0, notIssuable: 1, failed: 0 });
    expect(summary.routing.rooms.map((room) => room.objectiveMapping)).toEqual(["issued", "current", "not-issuable"]);
    expect(summary.headline).toContain("1 objective-mapping packet issued");
  });
});

describe("runAcceptanceSweep — withdrawn and outdated packets (BI-099A0BA3)", () => {
  it("counts withdrawn packets and rooms still on the outdated shape", async () => {
    const outcomes = ["withdrawn", "shape-outdated"] as const;
    const p = ports({
      route: vi.fn(async (candidates: readonly AgedSweepCandidate[]) => candidates.map((candidate, index) => ({
        itemId: candidate.item.itemId, ageDays: candidate.ageDays, outcome: "already-routed" as const,
        capsuleId: `WC-ACC-${candidate.item.id.toUpperCase()}`, ownerAgentId: null, reason: null,
        objectiveMapping: outcomes[index] ?? null,
      }))),
    });
    const summary = await runAcceptanceSweep(p, CONFIG);
    expect(summary.routing.objectiveMapping).toMatchObject({ withdrawn: 1, shapeOutdated: 1, issued: 0 });
  });
});

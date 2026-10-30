// BI-8E1486FA — the per-room overseer duty's rules, one at a time.

import { describe, expect, it } from "vitest";

import {
  EMPTY_OVERSEER_STATE,
  OVERSEER_HOLD_TICK_BUDGET,
  formatOverseerSummary,
  emptyOverseerSummary,
  planOverseerDuty,
  readOverseerState,
  type OverseerRoom,
} from "./workroom-overseer-duty";

const NOW = new Date("2026-10-27T12:00:00.000Z");
const DAY = 86_400_000;
const expiredDaysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

function room(over: Partial<OverseerRoom> = {}): OverseerRoom {
  return {
    id: "row-1", capsuleId: "WC-ROOM1", status: "ready", idempotencyKey: null, shapeKey: "delivery-medium",
    itemKey: "BI-ITEM1", itemStatus: "in-progress", itemEffortSize: "medium",
    leaseExpiresAt: new Date(NOW.getTime() + 30 * 60_000), merged: null, openPullRequest: false, pullRequestNumber: null,
    authoredHead: true, hold: null, driveAction: null, driveReason: null, assigneePrincipalRef: "PRN-OVERSEER",
    overseer: EMPTY_OVERSEER_STATE, inScan: true,
    ...over,
  };
}

function hold(ticks: number, key = "attention|role_stage|design-note") {
  return { key, since: "2026-10-20T00:00:00.000Z", ticks, stuckSince: null, stuckTicks: 0, notifiedAt: null };
}

const only = (rooms: OverseerRoom[]) => {
  const actions = planOverseerDuty(rooms, NOW);
  expect(actions.length).toBeLessThanOrEqual(1);
  return actions[0] ?? null;
};

describe("R1: a room whose item is finished is closed", () => {
  it("closes when the item is done and the PR merged", () => {
    const action = only([room({ itemStatus: "done", merged: true, pullRequestNumber: 6532 })]);
    expect(action).toMatchObject({ kind: "close", rule: "R1" });
    expect(action?.summary).toContain("Overseer R1");
    expect(action?.summary).toContain("PR #6532 merged");
  });

  it("closes when the item is retired and no PR is open", () => {
    expect(only([room({ itemStatus: "retired" })])).toMatchObject({ kind: "close", rule: "R1" });
  });

  it("does not close while the item's PR is still open", () => {
    expect(only([room({ itemStatus: "done", openPullRequest: true, merged: false })])).toBeNull();
  });

  it("does not close a room whose item is live, deferred or awaiting acceptance", () => {
    for (const itemStatus of ["in-progress", "deferred", "awaiting-acceptance", null]) {
      expect(only([room({ itemStatus })])).toBeNull();
    }
  });
});

describe("R2: a merged room whose session is gone is closed", () => {
  it("closes when the lease expired past the grace on a merged branch", () => {
    const action = only([room({ merged: true, leaseExpiresAt: expiredDaysAgo(5) })]);
    expect(action).toMatchObject({ kind: "close", rule: "R2" });
  });

  it("waits out the resume grace", () => {
    expect(only([room({ merged: true, leaseExpiresAt: new Date(NOW.getTime() - 2 * 3_600_000) })])).toBeNull();
  });

  it("never closes on an unknown merge state", () => {
    expect(only([room({ merged: null, authoredHead: false, leaseExpiresAt: expiredDaysAgo(5) })])).toBeNull();
  });
});

describe("R5: of two live rooms for one item, the merged one is closed", () => {
  it("closes the merged room and leaves the other", () => {
    const merged = room({ id: "row-m", capsuleId: "WC-MERGED", merged: true });
    const other = room({ id: "row-o", capsuleId: "WC-OTHER", merged: false, authoredHead: false });
    const actions = planOverseerDuty([merged, other], NOW);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "close", rule: "R5", room: { capsuleId: "WC-MERGED" } });
  });

  it("counts a sibling loaded outside the drive's scan but never acts on it", () => {
    const merged = room({ capsuleId: "WC-MERGED", merged: true });
    const sibling = room({ id: "row-s", capsuleId: "WC-SIB", merged: true, inScan: false });
    const actions = planOverseerDuty([merged, sibling], NOW);
    expect(actions.map((a) => a.room.capsuleId)).toEqual(["WC-MERGED"]);
  });

  it.each([null, "unknown-delivery", "obligation-assurance-watch"])(
    "does not treat a sibling with shape %s as another delivery room",
    (shapeKey) => {
      const merged = room({ id: "row-m", capsuleId: "WC-MERGED", merged: true, itemStatus: "awaiting-acceptance" });
      const sibling = room({ id: "row-s", capsuleId: "WC-STATUS-CHECK", shapeKey, merged: null, authoredHead: false, inScan: false });
      expect(planOverseerDuty([merged, sibling], NOW)).toEqual([]);
    },
  );

  it.each([
    ["standing", { idempotencyKey: "standing-room:test:v1" }],
    ["terminal", { status: "archived" }],
  ] as const)("does not count a %s sibling toward R5", (_label, exclusion) => {
    const merged = room({ id: "row-m", capsuleId: "WC-MERGED", merged: true });
    const sibling = room({ id: "row-s", capsuleId: "WC-OTHER", inScan: false, ...exclusion });
    expect(planOverseerDuty([merged, sibling], NOW)).toEqual([]);
  });

  it("does not fire for a lone merged room with a live lease", () => {
    expect(only([room({ merged: true })])).toBeNull();
  });

  it("does not close the second of two merged rooms once the first is closed", () => {
    const a = room({ id: "a", capsuleId: "WC-A", merged: true });
    const b = room({ id: "b", capsuleId: "WC-B", merged: true });
    expect(planOverseerDuty([a, b], NOW).map((x) => x.room.capsuleId)).toEqual(["WC-A"]);
  });
});

describe("R3: unmerged work whose session is gone is routed to the overseer", () => {
  const stale = () => room({ merged: false, leaseExpiresAt: expiredDaysAgo(6) });

  it("marks the room needs-resume and raises one attention item to the overseer", () => {
    const action = only([stale()]);
    expect(action).toMatchObject({ kind: "route", rule: "R3" });
    if (action?.kind !== "route") throw new Error("expected a route");
    expect(action.next.needsResume?.leaseExpiredAt).toBe(expiredDaysAgo(6).toISOString());
    expect(action.next.attention).toMatchObject({ rule: "R3", assigneePrincipalRef: "PRN-OVERSEER" });
  });

  it("does not raise again on the next cycle", () => {
    const first = only([stale()]);
    if (first?.kind !== "route") throw new Error("expected a route");
    expect(only([room({ ...stale(), overseer: first.next })])).toBeNull();
  });

  it("does not fire without authored commits", () => {
    expect(only([room({ merged: false, authoredHead: false, leaseExpiresAt: expiredDaysAgo(6) })])).toBeNull();
  });

  it("clears once the session renews its lease", () => {
    const first = only([stale()]);
    if (first?.kind !== "route") throw new Error("expected a route");
    const action = only([room({ merged: false, overseer: first.next })]);
    expect(action).toMatchObject({ kind: "clear", rule: "R3" });
    if (action?.kind !== "clear") throw new Error("expected a clear");
    expect(action.next.attention).toBeNull();
    expect(action.next.needsResume).toBeNull();
  });
});

describe("R4: a hold past the tick budget concludes", () => {
  it("derives the size from the declared shape when the item is unsized", () => {
    const action = only([room({ itemEffortSize: null, hold: hold(373), driveAction: "attention", driveReason: "role_stage" })]);
    expect(action).toMatchObject({ kind: "route", rule: "R4" });
    if (action?.kind !== "route") throw new Error("expected a route");
    expect(action.next.holdConclusion).toMatchObject({ outcome: "derived-size", derivedSize: "medium", ticks: 373 });
    expect(action.next.attention?.context).toContain("size_backlog_item");
  });

  it("concludes needs-owner when nothing can be derived", () => {
    const action = only([room({ hold: hold(OVERSEER_HOLD_TICK_BUDGET), driveAction: "pause", driveReason: "unknown_principal" })]);
    if (action?.kind !== "route") throw new Error("expected a route");
    expect(action.next.holdConclusion?.outcome).toBe("needs-owner");
  });

  it("stays within budget below the bound and while the room is not held", () => {
    expect(only([room({ hold: hold(OVERSEER_HOLD_TICK_BUDGET - 1), driveAction: "attention" })])).toBeNull();
    expect(only([room({ hold: hold(400), driveAction: "do_not_wake" })])).toBeNull();
    expect(only([room({ hold: hold(400), driveAction: "dispatch_agent" })])).toBeNull();
  });

  it("never concludes the same hold twice, and clears when the hold moves on", () => {
    const first = only([room({ hold: hold(60), driveAction: "attention" })]);
    if (first?.kind !== "route") throw new Error("expected a route");
    expect(only([room({ hold: hold(61), driveAction: "attention", overseer: first.next })])).toBeNull();
    const moved = only([room({ hold: hold(1, "attention|person_stage|merge"), driveAction: "attention", overseer: first.next })]);
    expect(moved).toMatchObject({ kind: "clear", rule: "R4" });
  });
});

describe("standing rooms and rooms outside the duty", () => {
  it("excludes standing rooms from every rule", () => {
    const standing = { idempotencyKey: "standing-room:coo:v1" };
    for (const over of [
      { itemStatus: "done", merged: true },
      { merged: true, leaseExpiresAt: expiredDaysAgo(5) },
      { merged: false, leaseExpiresAt: expiredDaysAgo(5) },
      { hold: hold(400), driveAction: "attention" },
    ] as Partial<OverseerRoom>[]) {
      expect(only([room({ ...over, ...standing })])).toBeNull();
    }
    expect(planOverseerDuty([room({ merged: true, ...standing }), room({ merged: true, capsuleId: "WC-2", ...standing })], NOW)).toEqual([]);
  });

  it("ignores rooms on a non-delivery shape and terminal rooms", () => {
    expect(only([room({ shapeKey: "obligation-assurance-watch", itemStatus: "done" })])).toBeNull();
    expect(only([room({ status: "archived", itemStatus: "done" })])).toBeNull();
  });
});

describe("stored state", () => {
  it("reads back what a route recorded and treats junk as nothing", () => {
    const action = only([room({ merged: false, leaseExpiresAt: expiredDaysAgo(6) })]);
    if (action?.kind !== "route") throw new Error("expected a route");
    expect(readOverseerState({ workroomOverseer: JSON.parse(JSON.stringify(action.next)) })).toEqual(action.next);
    expect(readOverseerState({ workroomOverseer: { attention: { rule: "R9" } } })).toEqual(EMPTY_OVERSEER_STATE);
    expect(readOverseerState(null)).toEqual(EMPTY_OVERSEER_STATE);
  });

  it("formats a one-line cycle summary", () => {
    const summary = emptyOverseerSummary(true, 3);
    summary.fired.R1 = 1;
    expect(formatOverseerSummary(summary)).toBe("[workroom-overseer] dry-run considered=3 R1=1 R2=0 R3=0 R4=0 R5=0 cleared=0 refused=0");
  });
});

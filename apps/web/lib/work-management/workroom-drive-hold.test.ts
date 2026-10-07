// BI-E8C78E80 — the drive records how long a room has been held in place, so
// its trail gets a row only when something changed and a stuck room reaches its
// owner once.
import { describe, expect, it } from "vitest";

import {
  driveHoldKey,
  driveTickIsNews,
  nextDriveHold,
  readDriveHold,
  stallNoticeDue,
  WORKROOM_DRIVE_STALL_TICKS,
  type WorkroomDriveHold,
} from "./workroom-drive-hold";

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 24, 0, minutes));
const pause = { action: "pause", reason: "conformance_pause", stageKey: "spec",
  conformance: { deviations: [{ code: "missing_explicit_coordinator" }] } };

function ticks(list: Array<typeof pause>, start: WorkroomDriveHold | null = null) {
  let hold = start;
  const out: WorkroomDriveHold[] = [];
  list.forEach((tick, i) => { hold = nextDriveHold(hold, tick, at(15 * i)); out.push(hold); });
  return out;
}

describe("workroom drive hold", () => {
  it("keys a hold by action, reason, stage and deviations, in any deviation order", () => {
    const a = driveHoldKey({ ...pause, conformance: { deviations: [{ code: "b" }, { code: "a" }] } });
    const b = driveHoldKey({ ...pause, conformance: { deviations: [{ code: "a" }, { code: "b" }] } });
    expect(a).toBe(b);
    expect(driveHoldKey({ ...pause, stageKey: "build" })).not.toBe(driveHoldKey(pause));
  });

  it("counts repeated identical ticks, keeps when the hold began, and records only the first", () => {
    const [first, second, third] = ticks([pause, pause, pause]);
    expect(first).toMatchObject({ ticks: 1, since: at(0).toISOString(), stuckTicks: 1 });
    expect(third).toMatchObject({ ticks: 3, since: at(0).toISOString(), stuckTicks: 3, stuckSince: at(0).toISOString() });
    expect(driveTickIsNews(null, first, "pause")).toBe(true);
    expect(driveTickIsNews(first, second, "pause")).toBe(false);
  });

  it("records a change of hold, and always records a dispatch", () => {
    const [first] = ticks([pause]);
    const escalate = nextDriveHold(first, { ...pause, action: "escalate", reason: "conformance_escalate" }, at(15));
    expect(driveTickIsNews(first, escalate, "escalate")).toBe(true);
    // Stuck is stuck whatever the reason: the stall streak continues across pause and escalate.
    expect(escalate).toMatchObject({ ticks: 1, stuckTicks: 2, stuckSince: at(0).toISOString() });
    const dispatch = { action: "dispatch_agent", reason: "agent_stage", stageKey: "spec", conformance: null };
    const d1 = nextDriveHold(null, dispatch, at(0));
    expect(driveTickIsNews(d1, nextDriveHold(d1, dispatch, at(15)), "dispatch_agent")).toBe(true);
  });

  it("resets the stuck spell when the room advances", () => {
    const held = ticks([pause, pause, pause, pause]);
    const moving = nextDriveHold(held[3], { action: "attention", reason: "role_stage", stageKey: "spec", conformance: null }, at(60));
    expect(moving).toMatchObject({ stuckSince: null, stuckTicks: 0, notifiedAt: null });
  });

  it("is due to tell the owner once, after an hour of the same stuck spell", () => {
    const held = ticks([pause, pause, pause, pause, pause]);
    expect(stallNoticeDue(held[WORKROOM_DRIVE_STALL_TICKS - 2])).toBe(false);
    const due = held[WORKROOM_DRIVE_STALL_TICKS - 1];
    expect(stallNoticeDue(due)).toBe(true);
    const told = { ...due, notifiedAt: at(45).toISOString() };
    expect(stallNoticeDue(nextDriveHold(told, pause, at(60)))).toBe(false);
  });

  it("reads the hold back from the stored snapshot and ignores a malformed one", () => {
    const [hold] = ticks([pause]);
    expect(readDriveHold({ workroomDrive: { hold } })).toEqual(hold);
    expect(readDriveHold({ workroomDrive: { hold: { key: 3 } } })).toBeNull();
    expect(readDriveHold(null)).toBeNull();
  });
});

// GPP Phase 3c PR-3c-1 (BI-8875C9DF): graph rooms key the hold on their marked
// stages and iterations; a sequential room's key is unchanged.
describe("the hold on a graph room (Phase 3c)", () => {
  it("markedKeys replace stageKey, sorted; absent, the key is exactly the sequential one", () => {
    const base = { action: "pause", reason: "conformance_pause", stageKey: "b", conformance: null };
    expect(driveHoldKey(base)).toBe("pause|conformance_pause|b");
    expect(driveHoldKey({ ...base, markedKeys: ["c#0", "b#1"] })).toBe("pause|conformance_pause|b#1,c#0");
  });

  it("a changed iteration changes the hold", () => {
    const tick = { action: "pause", reason: "executor_writeback_unavailable", stageKey: "b", conformance: null };
    const first = nextDriveHold(null, { ...tick, markedKeys: ["b#0"] }, at(0));
    const second = nextDriveHold(first, { ...tick, markedKeys: ["b#1"] }, at(15));
    expect(second.key).not.toBe(first.key);
    expect(second.ticks).toBe(1);
  });

  it("an iteration change is always news, even when the hold key did not change", () => {
    const hold = nextDriveHold(null, { action: "attention", reason: "governed_decision", stageKey: "b", conformance: null }, at(0));
    const same = nextDriveHold(hold, { action: "attention", reason: "governed_decision", stageKey: "b", conformance: null }, at(15));
    expect(driveTickIsNews(hold, same, "attention")).toBe(false);
    expect(driveTickIsNews(hold, same, "attention", false)).toBe(false);
    expect(driveTickIsNews(hold, same, "attention", true)).toBe(true);
  });
});

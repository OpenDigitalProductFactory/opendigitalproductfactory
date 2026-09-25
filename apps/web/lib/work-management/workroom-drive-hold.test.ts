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

import { describe, expect, it } from "vitest";
import { countOperatorAttention, projectWorkroomOperatorSummary } from "./workroom-operator-summary";
import type { EffectiveHumanAccountability } from "@/lib/work-management/human-accountability";

const owner: EffectiveHumanAccountability = { state: "resolved", principalId: "P-1", source: "organization-owner", inheritedFrom: [] };
const base = { capsuleId: "WC-1", status: "working", liveness: "live", isLive: true, accountability: owner };
describe("operator attention count", () => {
  it("includes shared recovery outside the bounded recent-room inventory", () => {
    expect(countOperatorAttention(["WC-RECENT"], ["WC-OLDER-HELD"])).toBe(2);
  });
  it("counts a room once when both inventory and recovery identify it", () => {
    expect(countOperatorAttention(["WC-1", "WC-2"], ["WC-2", "WC-2", "WC-3"])).toBe(3);
  });
  it("retains the attention count when only older shared recovery is present", () => {
    expect(countOperatorAttention([], ["WC-OLDER-HELD"])).toBe(1);
  });
});
describe("operator work groups", () => {
  it("does not mistake a held lease or capacity wait for current progress", () => {
    for (const liveness of ["leased-idle", "paused", "durable-wait"]) {
      expect(projectWorkroomOperatorSummary({ ...base, liveness }).group).toBe("waiting");
    }
    expect(projectWorkroomOperatorSummary(base).group).toBe("working");
  });
  it("prioritizes a recorded hold over a recent heartbeat", () => {
    const view = projectWorkroomOperatorSummary({ ...base, drive: { action: "pause", reason: "executor_writeback_unavailable" } });
    expect(view.group).toBe("attention");
    expect(view.nextAction).not.toMatch(/appoint|resume automatically/i);
    expect(view.recoveryCondition).toContain("executor records evidence");
  });
  it("shows stopped sessions as retained work rather than success", () => {
    const view = projectWorkroomOperatorSummary({ ...base, isLive: false, liveness: "lease-expired" });
    expect(view).toMatchObject({ group: "history", label: "inventory.status.ended" });
    expect(view.nextAction).not.toMatch(/completed|passed/i);
  });
  it("does not treat archival as evidence that work was delivered", () => {
    const view = projectWorkroomOperatorSummary({ ...base, status: "archived", isLive: false, liveness: "lease-expired" });
    expect(view).toMatchObject({ group: "history", label: "inventory.status.closed" });
  });
  it("retains the source-merge label only for the canonical delivered signal", () => {
    const view = projectWorkroomOperatorSummary({ ...base, status: "archived", isLive: false, liveness: "delivered" });
    expect(view).toMatchObject({ group: "history", label: "inventory.status.delivered" });
  });
  it("asks for accountability only when no recorded person resolves", () => {
    const view = projectWorkroomOperatorSummary({ ...base, accountability: { state: "setup-required", reason: "no-organization-owner-recorded", message: "No owner", atWorkroomId: null } });
    expect(view).toMatchObject({ group: "attention", nextAction: "inventory.nextAction.owner" });
  });
});

describe("operator groups derive from the shared atlas health", () => {
  const cases: Array<[string, Parameters<typeof projectWorkroomOperatorSummary>[0], string, string]> = [
    ["closeout waits on a person", { ...base, status: "ready-for-promotion" }, "needs-person", "attention"],
    ["a recorded decision waits on a person", { ...base, drive: { action: "attention", reason: "x", attentionRecorded: true } }, "needs-person", "attention"],
    ["a missing owner waits on a person", { ...base, accountability: { state: "setup-required", reason: "no-organization-owner-recorded", message: "No owner", atWorkroomId: null } }, "needs-person", "attention"],
    ["a drive pause is a hold", { ...base, drive: { action: "pause", reason: "executor_writeback_unavailable" } }, "stuck", "attention"],
    ["a stalled pull request is a hold", { ...base, liveness: "stalled" }, "stuck", "attention"],
    ["silence is no signal, not progress", { ...base, isLive: false, liveness: "no-signal" }, "no-signal", "attention"],
    ["an unknown liveness is no signal", { ...base, liveness: "something-new" }, "no-signal", "attention"],
    ["a capacity wait is waiting", { ...base, liveness: "durable-wait" }, "waiting", "waiting"],
    ["live work is working", base, "working", "working"],
    ["an ended session is finished", { ...base, isLive: false, liveness: "lease-expired" }, "finished", "history"],
  ];
  for (const [name, room, health, group] of cases) {
    it(name, () => {
      expect(projectWorkroomOperatorSummary(room)).toMatchObject({ health, group });
    });
  }
});


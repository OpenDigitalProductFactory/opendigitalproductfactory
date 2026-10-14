import { describe, expect, it } from "vitest";
import { projectWorkroomOperatorSummary } from "./workroom-operator-summary";
import type { EffectiveHumanAccountability } from "@/lib/work-management/human-accountability";

const owner: EffectiveHumanAccountability = { state: "resolved", principalId: "P-1", source: "organization-owner", inheritedFrom: [] };
const base = { capsuleId: "WC-1", status: "working", liveness: "live", isLive: true, accountability: owner };
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
    expect(view).toMatchObject({ group: "history", label: "Session ended" });
    expect(view.nextAction).not.toMatch(/completed|passed/i);
  });
  it("asks for accountability only when no recorded person resolves", () => {
    const view = projectWorkroomOperatorSummary({ ...base, accountability: { state: "setup-required", reason: "no-organization-owner-recorded", message: "No owner", atWorkroomId: null } });
    expect(view).toMatchObject({ group: "attention", nextAction: "Assign an accountable person in the room" });
  });
});

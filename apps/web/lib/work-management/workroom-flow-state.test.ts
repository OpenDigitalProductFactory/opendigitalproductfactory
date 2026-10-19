import { describe, expect, it } from "vitest";

import { everyDriveOutcome } from "./drive-conclusion";
import {
  WORKROOM_FLOW_STATES,
  classifyDriveSegment,
  countsTowardFlowTime,
} from "./workroom-flow-state";

describe("classifyDriveSegment — every drive outcome has a flow state", () => {
  it("classifies every action/reason pair in the drive vocabulary", () => {
    const unclassified = everyDriveOutcome().filter((outcome) => classifyDriveSegment(outcome) === null);
    expect(unclassified).toEqual([]);
  });

  it("refuses to guess at a pair the drive does not emit", () => {
    expect(classifyDriveSegment({ action: "pause", reason: "not_a_reason" })).toBeNull();
    expect(classifyDriveSegment({ action: "not_an_action", reason: "agent_stage" })).toBeNull();
    // A real reason under the wrong action is still unknown.
    expect(classifyDriveSegment({ action: "attention", reason: "agent_stage" })).toBeNull();
    expect(classifyDriveSegment({ action: "pause", reason: "toString" })).toBeNull();
  });
});

describe("classifyDriveSegment — the live drive log (30 days to 2026-10-02)", () => {
  // Every pair observed on the live install, with the state each must produce.
  const observed = [
    { action: "pause", reason: "conformance_pause", state: "blocked" },
    { action: "pause", reason: "executor_writeback_unavailable", state: "blocked" },
    { action: "attention", reason: "role_stage", state: "awaiting-person" },
    { action: "escalate", reason: "conformance_escalate", state: "blocked" },
    { action: "dispatch_agent", reason: "agent_stage", state: "working" },
    { action: "dispatch_agent", reason: "lease_held", state: "working" },
    { action: "attention", reason: "governed_decision", state: "awaiting-person" },
    { action: "stop", reason: "success", state: "done" },
    { action: "do_not_wake", reason: "cycle_complete", state: "awaiting-trigger" },
  ] as const;

  it.each(observed)("$action/$reason is $state", ({ action, reason, state }) => {
    expect(classifyDriveSegment({ action, reason })?.state).toBe(state);
  });

  it("names the cause of a blockage, so a pile of paused rooms can say why", () => {
    expect(classifyDriveSegment({ action: "pause", reason: "conformance_pause" })).toEqual({
      state: "blocked",
      cause: "conformance_pause",
    });
  });

  it("carries no cause for work that is not blocked", () => {
    expect(classifyDriveSegment({ action: "dispatch_agent", reason: "agent_stage" })?.cause).toBeNull();
  });
});

describe("refusals from the graph drive (GPP Phase 3c)", () => {
  it("treats a refusal with no route left as stuck work with a cause", () => {
    expect(classifyDriveSegment({ action: "attention", reason: "gate_refused" })).toEqual({
      state: "blocked",
      cause: "gate_refused",
    });
  });

  it("treats a refusal routed to a failure stop as the end of the room's flow", () => {
    expect(classifyDriveSegment({ action: "stop", reason: "refused_to_stop" })?.state).toBe("done");
  });
});

describe("standing rooms between cycles are not waiting work (spec §5.3)", () => {
  it("does not count a finished cycle or a quiet posture toward flow time", () => {
    for (const reason of ["cycle_complete", "quiet"] as const) {
      const classified = classifyDriveSegment({ action: "do_not_wake", reason });
      expect(classified?.state).toBe("awaiting-trigger");
      expect(countsTowardFlowTime(classified!.state)).toBe(false);
    }
  });

  it("counts working, waiting on a person and blocked; not done", () => {
    expect(WORKROOM_FLOW_STATES.filter(countsTowardFlowTime)).toEqual(["working", "awaiting-person", "blocked"]);
  });
});

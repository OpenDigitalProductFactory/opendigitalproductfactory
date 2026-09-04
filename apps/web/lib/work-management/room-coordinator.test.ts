import { describe, expect, it } from "vitest";

import {
  deriveRoomCoordinator,
  selectRoomCoordinator,
  WorkroomParticipantError,
} from "./room-coordinator";
import type { WorkroomParticipantRole, WorkroomParticipantView } from "./room-types";

function participant(
  principalRef: string,
  roles: WorkroomParticipantRole[],
  kind: WorkroomParticipantView["kind"] = "person",
): WorkroomParticipantView {
  return {
    principalRef,
    displayName: principalRef,
    kind,
    roles,
    workState: "unknown",
    presence: "unknown",
    currentWorkSummary: null,
    enteredReason: null,
    sponsorPrincipalRef: null,
    authoritySummary: "",
    sourceRefs: [],
    assignmentSource: "explicit",
    coordinatorSource: "none",
  };
}

describe("selectRoomCoordinator", () => {
  it("returns null when no coordinator is named", () => {
    expect(selectRoomCoordinator([participant("user:1", ["accountable"])])).toBeNull();
  });

  it("returns the single coordinator", () => {
    const coord = participant("agent:9", ["coordinator"], "agent");
    expect(selectRoomCoordinator([participant("user:1", ["accountable"]), coord])).toBe(coord);
  });

  it("throws on more than one active coordinator", () => {
    const two = [participant("user:1", ["coordinator"]), participant("agent:9", ["coordinator"], "agent")];
    expect(() => selectRoomCoordinator(two)).toThrow(WorkroomParticipantError);
    try {
      selectRoomCoordinator(two);
    } catch (error) {
      expect((error as WorkroomParticipantError).reason).toBe("multiple_active_coordinators");
    }
  });
});

describe("deriveRoomCoordinator", () => {
  it("defaults the sole accountable principal to coordinator", () => {
    const out = deriveRoomCoordinator([
      participant("user:1", ["accountable"]),
      participant("agent:9", ["contributor"], "agent"),
    ]);
    expect(out.find((p) => p.principalRef === "user:1")?.roles).toEqual(["accountable", "coordinator"]);
    expect(out.find((p) => p.principalRef === "agent:9")?.roles).toEqual(["contributor"]);
    expect(selectRoomCoordinator(out)?.principalRef).toBe("user:1");
  });

  it("keeps an explicitly named coordinator (may differ from accountable)", () => {
    const out = deriveRoomCoordinator([
      participant("user:1", ["accountable"]),
      participant("agent:9", ["coordinator"], "agent"),
    ]);
    // Accountable is NOT promoted when a coordinator is already named.
    expect(out.find((p) => p.principalRef === "user:1")?.roles).toEqual(["accountable"]);
    expect(selectRoomCoordinator(out)?.principalRef).toBe("agent:9");
  });

  it("does not invent a coordinator when accountability is ambiguous", () => {
    const out = deriveRoomCoordinator([
      participant("user:1", ["accountable"]),
      participant("user:2", ["accountable"]),
    ]);
    expect(selectRoomCoordinator(out)).toBeNull();
  });

  it("leaves a room with no accountable and no coordinator unchanged", () => {
    const out = deriveRoomCoordinator([participant("agent:9", ["contributor"], "agent")]);
    expect(selectRoomCoordinator(out)).toBeNull();
    expect(out[0].roles).toEqual(["contributor"]);
  });

  it("does not duplicate the role when accountable already coordinates", () => {
    const out = deriveRoomCoordinator([participant("user:1", ["accountable", "coordinator"])]);
    expect(out[0].roles).toEqual(["accountable", "coordinator"]);
  });
});

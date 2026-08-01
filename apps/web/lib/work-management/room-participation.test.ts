import { describe, expect, it } from "vitest";

import {
  authorizeWorkRoomAccess,
  projectWorkRoomParticipants,
} from "./room-participation";

describe("Work Room participation", () => {
  it("keeps an unauthorized room non-discoverable", () => {
    expect(authorizeWorkRoomAccess({
      requested: "content",
      principalRef: "PRN-OUTSIDER",
      assignedPrincipalRefs: ["PRN-OWNER"],
      discoverablePrincipalRefs: [],
      sensitivityCeiling: "confidential",
      sensitivityClearance: ["public", "internal"],
      isSuperuser: false,
    })).toEqual({ level: "none", reason: "not-admitted" });
  });

  it("limits discover-only participants to explicitly safe metadata", () => {
    expect(authorizeWorkRoomAccess({
      requested: "content",
      principalRef: "PRN-OBSERVER",
      assignedPrincipalRefs: ["PRN-OWNER"],
      discoverablePrincipalRefs: ["PRN-OBSERVER"],
      sensitivityCeiling: "internal",
      sensitivityClearance: ["public", "internal"],
      isSuperuser: false,
    })).toEqual({ level: "discover", reason: "discover-only" });
  });

  it("never lets presence expand authority", () => {
    expect(authorizeWorkRoomAccess({
      requested: "action",
      principalRef: "PRN-PRESENT",
      assignedPrincipalRefs: [],
      discoverablePrincipalRefs: [],
      presentPrincipalRefs: ["PRN-PRESENT"],
      sensitivityCeiling: "public",
      sensitivityClearance: ["public"],
      isSuperuser: false,
    }).level).toBe("none");
  });

  it("projects assigned people and lineage-derived AI coworkers with accountability", () => {
    expect(projectWorkRoomParticipants({
      assignments: [{
        principalRef: "PRN-HUMAN",
        displayName: "Mara Chen",
        kind: "person",
        roles: ["accountable"],
        currentWorkSummary: "Approve the exception",
        enteredReason: "Assigned owner",
        sponsorPrincipalRef: null,
        authoritySummary: "May review and approve",
      }],
      conversationParticipants: [{
        principalRef: "PRN-AGENT",
        displayName: "Case Coordinator",
        roles: ["contributor"],
        workState: "working",
        currentWorkSummary: "Gathering verification evidence",
        enteredReason: "Spawned by the room's active work lineage",
        sponsorPrincipalRef: "PRN-HUMAN",
        authoritySummary: "May prepare; approval remains with Mara Chen",
        sourceRef: { kind: "evidence", id: "TR-1", sourceType: "task-run" },
      }],
      presence: [{
        principalType: "agent",
        principalId: "PRN-AGENT",
        label: "Case Coordinator",
      }],
    })).toEqual([
      expect.objectContaining({ principalRef: "PRN-HUMAN", presence: "unknown" }),
      expect.objectContaining({
        principalRef: "PRN-AGENT",
        kind: "agent",
        presence: "active",
        sponsorPrincipalRef: "PRN-HUMAN",
        enteredReason: "Spawned by the room's active work lineage",
      }),
    ]);
  });
});

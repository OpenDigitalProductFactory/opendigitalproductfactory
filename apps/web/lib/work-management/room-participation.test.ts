import { describe, expect, it } from "vitest";

import {
  authorizeWorkRoomAccess,
  projectWorkRoomDiscovery,
  projectWorkRoomParticipants,
} from "./room-participation";
import {
  bindWorkRoomShape,
  getWorkRoomShape,
  WORK_ROOM_SHAPE_KEYS,
} from "./room-shapes";

describe("Work Room participation", () => {
  it("registers the five consequential collaboration shapes", () => {
    expect(WORK_ROOM_SHAPE_KEYS).toEqual([
      "specialist-alignment", "approval-sign-off", "outward-review",
      "change-consequential", "escalation",
    ]);
    expect(getWorkRoomShape("specialist-alignment")).toMatchObject({
      authorityLadderLevel: "action",
      inclusionOrder: ["coordinator", "specialist", "approver"],
    });
  });

  it.each(["person", "agent"] as const)(
    "requires the same specialist-alignment roles for a %s initiator",
    (kind) => {
      const binding = bindWorkRoomShape({
        shape: "specialist-alignment",
        initiator: { principalRef: "PRN-INIT", kind },
        participants: {
          coordinator: "PRN-COORD", specialist: "PRN-SPECIALIST", approver: "PRN-OWNER",
        },
        sensitivityCeiling: "confidential",
      });
      expect(binding.requiredParticipants.map((participant) => participant.role))
        .toEqual(["coordinator", "specialist", "approver"]);
      expect(binding.authorityLadderLevel).toBe("action");
      expect(binding.stepUpRequired).toBe(true);
      expect(binding.gaps).toEqual([]);
    },
  );

  it("fails closed when a shape-required participant is absent", () => {
    expect(bindWorkRoomShape({
      shape: "outward-review",
      initiator: { principalRef: "PRN-INIT", kind: "person" },
      participants: { coordinator: "PRN-INIT", specialist: "PRN-BRAND" },
      sensitivityCeiling: "internal",
    })).toMatchObject({ allowed: false, gaps: ["approver"] });
  });

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
    const decision = authorizeWorkRoomAccess({
      requested: "content",
      principalRef: "PRN-OBSERVER",
      assignedPrincipalRefs: ["PRN-OWNER"],
      discoverablePrincipalRefs: ["PRN-OBSERVER"],
      sensitivityCeiling: "internal",
      sensitivityClearance: ["public", "internal"],
      isSuperuser: false,
    });
    expect(decision).toEqual({ level: "discover", reason: "discover-only" });
    expect(projectWorkRoomDiscovery({
      decision,
      allowedFields: ["title", "mode"],
      metadata: {
        title: "Quarterly access review",
        outcome: "Every exception has an accountable disposition.",
        mode: "standing",
      },
    })).toEqual({
      accessLevel: "discover",
      title: "Quarterly access review",
      outcome: null,
      mode: "standing",
    });
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
      }, {
        principalRef: "PRN-REVIEWER",
        displayName: "Noah Williams",
        kind: "person",
        roles: ["reviewer"],
        currentWorkSummary: null,
        enteredReason: "Named reviewer",
        sponsorPrincipalRef: null,
        authoritySummary: "May review evidence",
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
        principalRef: "PRN-REVIEWER",
        roles: ["reviewer"],
        enteredReason: "Named reviewer",
      }),
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

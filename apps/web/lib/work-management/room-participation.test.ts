import { describe, expect, it } from "vitest";

import {
  authorizeWorkroomAccess,
  projectWorkroomDiscovery,
  projectWorkroomParticipants,
} from "./room-participation";
import {
  bindWorkroomShape,
  getWorkroomShape,
  WORKROOM_SHAPE_KEYS,
} from "./room-shapes";

describe("Work Room participation", () => {
  it("registers the consequential collaboration shapes plus the standing craft shape", () => {
    expect(WORKROOM_SHAPE_KEYS).toEqual([
      "specialist-alignment", "approval-sign-off", "outward-review",
      "change-consequential", "escalation", "craft-stewardship",
    ]);
    expect(getWorkroomShape("specialist-alignment")).toMatchObject({
      authorityLadderLevel: "action",
      inclusionOrder: ["coordinator", "specialist", "approver"],
    });
    expect(getWorkroomShape("craft-stewardship")).toMatchObject({
      authorityLadderLevel: "content",
      sensitivityStepUp: false,
      inclusionOrder: ["coordinator", "specialist"],
    });
  });

  it.each(["person", "agent"] as const)(
    "requires the same specialist-alignment roles for a %s initiator",
    (kind) => {
      const binding = bindWorkroomShape({
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
    expect(bindWorkroomShape({
      shape: "outward-review",
      initiator: { principalRef: "PRN-INIT", kind: "person" },
      participants: { coordinator: "PRN-INIT", specialist: "PRN-BRAND" },
      sensitivityCeiling: "internal",
    })).toMatchObject({ allowed: false, gaps: ["approver"] });
  });

  it("keeps an unauthorized room non-discoverable", () => {
    expect(authorizeWorkroomAccess({
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
    const decision = authorizeWorkroomAccess({
      requested: "content",
      principalRef: "PRN-OBSERVER",
      assignedPrincipalRefs: ["PRN-OWNER"],
      discoverablePrincipalRefs: ["PRN-OBSERVER"],
      sensitivityCeiling: "internal",
      sensitivityClearance: ["public", "internal"],
      isSuperuser: false,
    });
    expect(decision).toEqual({ level: "discover", reason: "discover-only" });
    expect(projectWorkroomDiscovery({
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
    expect(authorizeWorkroomAccess({
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
    expect(projectWorkroomParticipants({
      assignments: [{
        principalRef: "PRN-HUMAN",
        displayName: "Mara Chen",
        kind: "person",
        roles: ["accountable"],
        currentWorkSummary: "Approve the exception",
        enteredReason: "Assigned owner",
        sponsorPrincipalRef: null,
        authoritySummary: "May review and approve",
        assignmentSource: "explicit",
      }, {
        principalRef: "PRN-REVIEWER",
        displayName: "Noah Williams",
        kind: "person",
        roles: ["reviewer"],
        currentWorkSummary: null,
        enteredReason: "Named reviewer",
        sponsorPrincipalRef: null,
        authoritySummary: "May review evidence",
        assignmentSource: "explicit",
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

import { describe, expect, it } from "vitest";

import {
  authorizeWorkspaceRoomItem,
  readWorkspaceRoomPolicy,
} from "./workspace-room-access";

describe("Workspace Work Room access", () => {
  it("separates explicit content admission from action authority", () => {
    const item = {
      assignedToUserId: "user-2",
      evidence: [{
        workroomPolicy: {
          admittedPrincipalRefs: ["PRN-1"],
          actionPrincipalRefs: [],
          sensitivityCeiling: "internal",
        },
      }],
    };
    const authContext = {
      principalId: "PRN-1",
      sensitivityClearance: ["public", "internal"],
      isSuperuser: false,
    };

    expect(authorizeWorkspaceRoomItem({
      requested: "content",
      item,
      userId: "user-1",
      authContext,
    }).level).toBe("content");
    expect(authorizeWorkspaceRoomItem({
      requested: "action",
      item,
      userId: "user-1",
      authContext,
    }).level).toBe("none");
  });

  it("lets an assigned principal act without allowing a presence record to substitute", () => {
    expect(authorizeWorkspaceRoomItem({
      requested: "action",
      item: { assignedToUserId: "user-1" },
      userId: "user-1",
      authContext: {
        principalId: "PRN-1",
        sensitivityClearance: ["public", "internal"],
        isSuperuser: false,
      },
    }).level).toBe("action");
  });

  it("uses the latest appended policy instead of stale earlier authority", () => {
    expect(authorizeWorkspaceRoomItem({
      requested: "content",
      item: {
        assignedToUserId: "user-2",
        evidence: [
          { workroomPolicy: { admittedPrincipalRefs: ["PRN-1"], sensitivityCeiling: "internal" } },
          { workroomPolicy: { admittedPrincipalRefs: [], sensitivityCeiling: "confidential" } },
        ],
      },
      userId: "user-1",
      authContext: {
        principalId: "PRN-1",
        sensitivityClearance: ["public", "internal", "confidential"],
        isSuperuser: false,
      },
    }).level).toBe("none");
  });

  it("parses specialist and approver roles on the policy roster", () => {
    expect(readWorkspaceRoomPolicy([{ workroomPolicy: {
      participants: [{
        principalRef: "PRN-SPEC",
        roles: ["specialist", "approver"],
        enteredReason: "Named specialist-approver",
      }],
    } }]).participants).toEqual([{
      principalRef: "PRN-SPEC",
      roles: ["specialist", "approver"],
      enteredReason: "Named specialist-approver",
      currentWorkSummary: null,
    }]);
  });

  it("parses explicitly named participants separately from access admission", () => {
    expect(readWorkspaceRoomPolicy([{ workroomPolicy: {
      admittedPrincipalRefs: ["PRN-REVIEWER"],
      participants: [{
        principalRef: "PRN-REVIEWER",
        roles: ["reviewer"],
        enteredReason: "Reviews the outcome packet",
      }],
    } }])).toMatchObject({
      admittedPrincipalRefs: ["PRN-REVIEWER"],
      participants: [{
        principalRef: "PRN-REVIEWER",
        roles: ["reviewer"],
        enteredReason: "Reviews the outcome packet",
        currentWorkSummary: null,
      }],
    });
  });
});

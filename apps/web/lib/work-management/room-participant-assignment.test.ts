import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  WORKROOM_PARTICIPANT_ROLES,
  assertAssignmentDoesNotCarryProactivity,
  parsePersistedWorkroomParticipantAssignment,
  projectPersistedWorkroomRoster,
  resolveCoordinatorSource,
} from "./room-participant-assignment";
import { deriveRoomCoordinator, selectExplicitRoomCoordinator } from "./room-coordinator";
import type { WorkroomParticipantRole, WorkroomParticipantView } from "./room-types";

function participant(
  principalRef: string,
  roles: WorkroomParticipantRole[],
  extras: Partial<WorkroomParticipantView> = {},
): WorkroomParticipantView {
  return {
    principalRef,
    displayName: principalRef,
    kind: "person",
    roles,
    workState: "unknown",
    presence: "unknown",
    currentWorkSummary: null,
    enteredReason: null,
    sponsorPrincipalRef: null,
    authoritySummary: "",
    sourceRefs: [],
    assignmentSource: extras.assignmentSource ?? "explicit",
    coordinatorSource: extras.coordinatorSource ?? "none",
    ...extras,
  };
}

describe("Workroom participant assignment contract (BI-4CB2EF76)", () => {
  it("accepts every canonical participant role, including specialist and approver", () => {
    expect(WORKROOM_PARTICIPANT_ROLES).toEqual([
      "accountable",
      "coordinator",
      "contributor",
      "specialist",
      "approver",
      "reviewer",
      "observer",
    ]);

    const parsed = parsePersistedWorkroomParticipantAssignment({
      workroomId: "wc-row-1",
      principalRef: "PRN-OWNER",
      roles: ["accountable", "coordinator", "specialist", "approver"],
      assignmentSource: "explicit",
      enteredReason: "Named Process Overseer",
      currentWorkSummary: null,
    });
    expect(parsed.roles).toEqual(["accountable", "coordinator", "specialist", "approver"]);
    expect(parsed.assignmentSource).toBe("explicit");
  });

  it("refuses to persist coworker-owned proactivity onto the room roster", () => {
    expect(() =>
      assertAssignmentDoesNotCarryProactivity({
        workroomId: "wc-row-1",
        principalRef: "PRN-AGENT",
        roles: ["coordinator"],
        assignmentSource: "explicit",
        proactivity: { family: "obligation-assurance", cadence: "daily" },
        coworkerPreference: { quietHours: true },
      }),
    ).toThrow(/proactivity/i);
  });

  it("distinguishes an explicit persisted coordinator from a derived one", () => {
    const explicit = participant("PRN-COORD", ["coordinator"], {
      assignmentSource: "explicit",
      coordinatorSource: "explicit",
    });
    const derived = deriveRoomCoordinator([
      participant("PRN-OWNER", ["accountable"], { assignmentSource: "legacy", coordinatorSource: "none" }),
    ]);
    expect(selectExplicitRoomCoordinator([explicit])?.principalRef).toBe("PRN-COORD");
    expect(selectExplicitRoomCoordinator(derived)).toBeNull();
    expect(derived[0]?.coordinatorSource).toBe("derived");
    expect(derived[0]?.roles).toContain("coordinator");
    expect(resolveCoordinatorSource({
      roles: derived[0]!.roles,
      assignmentSource: "legacy",
      coordinatorWasDerived: true,
    })).toBe("derived");
  });

  it("projects one roster from persisted assignments without a conversation overlay", () => {
    const roster = projectPersistedWorkroomRoster({
      assignments: [
        {
          workroomId: "wc-row-1",
          principalRef: "PRN-OWNER",
          displayName: "Mara Chen",
          kind: "person",
          roles: ["accountable", "coordinator"],
          assignmentSource: "explicit",
          enteredReason: "Named in the room",
          currentWorkSummary: null,
          sponsorPrincipalRef: null,
          sponsorDisplayName: null,
          authoritySummary: "Owns the outcome",
        },
        {
          workroomId: "wc-row-1",
          principalRef: "PRN-REVIEWER",
          displayName: "Noah Williams",
          kind: "person",
          roles: ["reviewer"],
          assignmentSource: "explicit",
          enteredReason: "Named reviewer",
          currentWorkSummary: null,
          sponsorPrincipalRef: null,
          sponsorDisplayName: null,
          authoritySummary: "May review evidence",
        },
      ],
      presencePrincipalRefs: [],
    });
    expect(roster.map((row) => row.principalRef)).toEqual(["PRN-OWNER", "PRN-REVIEWER"]);
    expect(selectExplicitRoomCoordinator(roster)?.principalRef).toBe("PRN-OWNER");
    expect(roster.find((row) => row.principalRef === "PRN-OWNER")?.assignmentSource).toBe("explicit");
    expect(roster.find((row) => row.principalRef === "PRN-OWNER")?.coordinatorSource).toBe("explicit");
  });

  it("does not treat a legacy assignment as an explicit Process Overseer", () => {
    const roster = projectPersistedWorkroomRoster({
      assignments: [{
        workroomId: "wc-row-1",
        principalRef: "PRN-OWNER",
        displayName: "Mara Chen",
        kind: "person",
        roles: ["accountable"],
        assignmentSource: "legacy",
        enteredReason: "Assigned to this room's work",
        currentWorkSummary: "Approve the exception",
        sponsorPrincipalRef: null,
        sponsorDisplayName: null,
        authoritySummary: "Owns the outcome",
      }],
      presencePrincipalRefs: [],
    });
    const derived = deriveRoomCoordinator(roster);
    expect(derived[0]?.assignmentSource).toBe("legacy");
    expect(derived[0]?.coordinatorSource).toBe("derived");
    expect(selectExplicitRoomCoordinator(derived)).toBeNull();
  });
});

describe("Workroom participant persistence migration (BI-4CB2EF76)", () => {
  it("backfills live-shaped WorkItem policy participants without inventing a coordinator", () => {
    const sql = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../../../packages/db/prisma/migrations/20260901040000_add_workroom_participant_assignments/migration.sql",
      ),
      "utf8",
    );
    expect(sql).toMatch(/CREATE TABLE "WorkCapsuleParticipant"/);
    expect(sql).toMatch(/ON CONFLICT \("workroomId", "principalId"\) DO NOTHING/);
    expect(sql).toMatch(/workroomPolicy/);
    expect(sql).toMatch(/assignmentSource/);
    expect(sql).toMatch(/'legacy'/);
    expect(sql).toMatch(/'explicit'/);
    expect(sql).not.toMatch(/accountable.*coordinator/i);
    expect(sql).toMatch(/330|existing WorkCapsule|WorkItem/);
  });
});

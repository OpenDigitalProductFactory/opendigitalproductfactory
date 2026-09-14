// Appointing a Workroom's owner (BI-F63200A8).
//
// WC-A69BCABB woke 100 times and refused every one:
//   conformance_pause / missing_explicit_coordinator
// The roster carrier, the role vocabulary and the conformance rules all existed.
// persistWorkroomParticipantAssignment could always write an owner — it simply
// had no caller. This is that caller, and these are the refusals that keep an
// appointment from making the room worse instead of better.

import { describe, expect, it } from "vitest";

import {
  COORDINATOR_ROLES,
  planCoordinatorAppointment,
  rolesAfterStandDown,
  type AppointCoordinatorDb,
} from "./appoint-room-coordinator";

function db(opts: {
  room?: { id: string; capsuleId: string } | null;
  principal?: { id: string; displayName: string } | null;
  participants?: Array<{ id?: string; principalId: string; roles: string[] }>;
}): AppointCoordinatorDb {
  return {
    workroom: {
      findUnique: async () =>
        opts.room === undefined ? { id: "room-1", capsuleId: "WC-TEST" } : opts.room,
    },
    principal: {
      findFirst: async () =>
        opts.principal === undefined ? { id: "pid-1", displayName: "Security Engineer" } : opts.principal,
    },
    workroomParticipant: {
      findMany: async () =>
        (opts.participants ?? []).map((participant, i) => ({
          id: participant.id ?? `wcp-${i}`,
          principalId: participant.principalId,
          roles: participant.roles,
        })),
    },
  };
}

const base = { capsuleId: "WC-TEST", principalRef: "PRN-1", replaceExisting: false };

describe("planCoordinatorAppointment", () => {
  it("appoints an owner for a room that has none", async () => {
    const plan = await planCoordinatorAppointment({ db: db({}), ...base });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.data.workroomId).toBe("room-1");
    expect(plan.data.principalRef).toBe("PRN-1");
    expect(plan.data.displayName).toBe("Security Engineer");
  });

  it("writes the coordinator role — the role conformance actually looks for", async () => {
    // A participant added with any other role leaves the room paused, which is
    // exactly how invite_room_participant fails to solve this.
    expect(COORDINATOR_ROLES).toEqual(["coordinator"]);
  });

  it("refuses an unknown room rather than writing an orphan row", async () => {
    const plan = await planCoordinatorAppointment({ db: db({ room: null }), ...base });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error).toMatch(/^workroom_not_found/);
  });

  it("refuses an inactive or unknown principal", async () => {
    // The dangerous case: the row persists, the room LOOKS owned, and it still
    // refuses to execute — indistinguishable from the bug this work removes.
    const plan = await planCoordinatorAppointment({ db: db({ principal: null }), ...base });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error).toMatch(/^principal_not_found/);
    expect(plan.error).toMatch(/answer for the room/);
  });

  it("refuses a second coordinator rather than silently adding one", async () => {
    // conformance treats multiple_coordinators as BLOCKING, so a silent second
    // appointment would leave the room more stuck than before it was made.
    const plan = await planCoordinatorAppointment({
      db: db({ participants: [{ principalId: "other", roles: ["coordinator"] }] }),
      ...base,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error).toMatch(/^coordinator_already_appointed/);
    expect(plan.error).toMatch(/exactly one/);
  });

  it("allows an explicit hand-over", async () => {
    const plan = await planCoordinatorAppointment({
      db: db({ participants: [{ principalId: "other", roles: ["coordinator"] }] }),
      ...base,
      replaceExisting: true,
    });
    expect(plan.ok).toBe(true);
  });

  // BI-061B2BC0: replaceExisting used to authorize the appointment and then the
  // caller wrote ONLY the appointee, so a "hand-over" produced a room with two
  // active coordinators — which conformance treats as blocking. The plan must
  // name who to stand down, or the caller cannot complete the hand-over.
  it("names the incumbent to stand down on an explicit hand-over", async () => {
    const plan = await planCoordinatorAppointment({
      db: db({
        participants: [{ id: "wcp-old", principalId: "other", roles: ["coordinator"] }],
      }),
      ...base,
      replaceExisting: true,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.data.standDown).toEqual([
      { participantId: "wcp-old", principalId: "other", roles: ["coordinator"] },
    ]);
  });

  it("stands down every incumbent when a room already carries several", async () => {
    // The repair case: a room that already went wrong must converge to one.
    const plan = await planCoordinatorAppointment({
      db: db({
        participants: [
          { id: "wcp-a", principalId: "a", roles: ["coordinator"] },
          { id: "wcp-b", principalId: "b", roles: ["coordinator", "reviewer"] },
        ],
      }),
      ...base,
      replaceExisting: true,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.data.standDown.map((p) => p.participantId)).toEqual(["wcp-a", "wcp-b"]);
  });

  it("stands nobody down when re-appointing the principal who already owns it", async () => {
    const plan = await planCoordinatorAppointment({
      db: db({ participants: [{ principalId: "pid-1", roles: ["coordinator"] }] }),
      ...base,
      replaceExisting: true,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.data.standDown).toEqual([]);
  });

  it("names nobody to stand down when the room had no coordinator", async () => {
    const plan = await planCoordinatorAppointment({ db: db({}), ...base });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.data.standDown).toEqual([]);
  });
});

describe("rolesAfterStandDown", () => {
  it("keeps the principal in the room as a contributor when coordinator was their only role", () => {
    // Demote, do not evict: they were working in the room and usually still are,
    // and a participant with an empty role set is not a state the roster models.
    expect(rolesAfterStandDown(["coordinator"])).toEqual(["contributor"]);
  });

  it("keeps every other role they held", () => {
    expect(rolesAfterStandDown(["coordinator", "reviewer", "approver"])).toEqual([
      "reviewer",
      "approver",
    ]);
  });

  it("is a no-op for someone who was never coordinator", () => {
    expect(rolesAfterStandDown(["reviewer"])).toEqual(["reviewer"]);
  });

  it("is idempotent for the principal who already owns the room", async () => {
    // Re-appointing the same owner must not be read as a second coordinator.
    const plan = await planCoordinatorAppointment({
      db: db({ participants: [{ principalId: "pid-1", roles: ["coordinator"] }] }),
      ...base,
    });
    expect(plan.ok).toBe(true);
  });

  it("ignores non-coordinator participants when counting owners", async () => {
    const plan = await planCoordinatorAppointment({
      db: db({
        participants: [
          { principalId: "a", roles: ["reviewer"] },
          { principalId: "b", roles: ["specialist", "approver"] },
        ],
      }),
      ...base,
    });
    expect(plan.ok).toBe(true);
  });
});

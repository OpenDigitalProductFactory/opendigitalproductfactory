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
  type AppointCoordinatorDb,
} from "./appoint-room-coordinator";

function db(opts: {
  room?: { id: string; capsuleId: string } | null;
  principal?: { id: string; displayName: string } | null;
  participants?: Array<{ principalId: string; roles: string[] }>;
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
      findMany: async () => opts.participants ?? [],
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

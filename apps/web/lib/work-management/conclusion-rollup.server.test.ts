// The wiring proof for phase 2. conclusion-rollup.test.ts proves the
// judgements; this proves the read composes the real substrate into them —
// the objective's posture, the conclusion the drive already wrote on each room,
// and the organization's stated purpose.
import { describe, expect, it, vi } from "vitest";

import { currentObservation, loadOutcomeRollup, readRoomConclusion } from "./conclusion-rollup.server";

describe("readRoomConclusion", () => {
  it("reads the conclusion the drive persisted onto the room", () => {
    const conclusion = readRoomConclusion({
      workroomDrive: {
        conclusion: { kind: "blocked", action: "stop", reason: "empty_read", blockage: null, summary: "stuck" },
      },
    });
    expect(conclusion?.kind).toBe("blocked");
  });

  it("returns null for a room whose snapshot predates phase 1, rather than guessing", () => {
    expect(readRoomConclusion({ workroomDrive: { lastCycleKey: "c1" } })).toBeNull();
    expect(readRoomConclusion({})).toBeNull();
    expect(readRoomConclusion(null)).toBeNull();
  });

  it("refuses a malformed conclusion instead of passing it up as a verdict", () => {
    expect(readRoomConclusion({ workroomDrive: { conclusion: { kind: 7 } } })).toBeNull();
    expect(readRoomConclusion({ workroomDrive: { conclusion: { kind: "blocked" } } })).toBeNull();
  });
});

describe("currentObservation — a correction supersedes exactly one row", () => {
  it("skips a superseded observation and takes the newest surviving one", () => {
    const observations = [
      { id: "OBS-3", supersedesObservationId: "OBS-2" },
      { id: "OBS-2", supersedesObservationId: null },
      { id: "OBS-1", supersedesObservationId: null },
    ];
    expect(currentObservation(observations)?.id).toBe("OBS-3");
  });

  it("takes the newest surviving row when the newest itself was corrected", () => {
    const observations = [
      { id: "OBS-3", supersedesObservationId: null },
      { id: "OBS-2", supersedesObservationId: null },
    ];
    // OBS-3 supersedes nothing and nothing supersedes it: it stands.
    expect(currentObservation(observations)?.id).toBe("OBS-3");

    const corrected = [
      { id: "OBS-4", supersedesObservationId: "OBS-3" },
      { id: "OBS-3", supersedesObservationId: null },
    ];
    expect(currentObservation(corrected)?.id).toBe("OBS-4");
  });

  it("answers null for an objective nobody has observed", () => {
    expect(currentObservation([])).toBeNull();
  });
});

type DbOverrides = {
  mission?: string | null;
  topAccountablePrincipalId?: string | null;
  objectives?: Record<string, unknown>[];
  observations?: Record<string, unknown>[];
  links?: Record<string, unknown>[];
  rooms?: Record<string, unknown>[];
};

function db(overrides: DbOverrides = {}) {
  return {
    organization: {
      findUnique: vi.fn(async () => ({
        id: "ORG-1",
        topAccountablePrincipalId: overrides.topAccountablePrincipalId === undefined
          ? "PRN-OWNER"
          : overrides.topAccountablePrincipalId,
      })),
    },
    businessContext: {
      findUnique: vi.fn(async () => ({
        mission: overrides.mission === undefined
          ? "Every animal we take in leaves with a family."
          : overrides.mission,
      })),
    },
    productObjective: {
      findMany: vi.fn(async () => overrides.objectives ?? []),
    },
    productOutcomeObservation: {
      findMany: vi.fn(async () => overrides.observations ?? []),
    },
    productObjectiveWork: {
      findMany: vi.fn(async () => overrides.links ?? []),
    },
    workroom: {
      findMany: vi.fn(async () => overrides.rooms ?? []),
    },
  } as never;
}

const OBJECTIVE = {
  id: "obj-row-1",
  objectiveId: "OBJ-1",
  title: "Rehome every animal within 30 days",
  status: "active",
  measureKind: "quantitative",
  measureUnit: "days",
  baselineValue: 45,
  targetValue: 30,
  targetNarrative: null,
};

describe("loadOutcomeRollup — the read behind one visible answer (AC-CS-05)", () => {
  it("an organization with no stated purpose is unconcluded, whatever its objectives say", async () => {
    const rollup = await loadOutcomeRollup(db({ mission: null }), { organizationId: "ORG-1" });
    expect(rollup.organization.kind).toBe("unconcluded");
    expect(rollup.organization.blockages.at(-1)?.level).toBe("organization");
  });

  it("an unmet objective with no work linked is a blockage owned by the organization's accountable", async () => {
    const rollup = await loadOutcomeRollup(
      db({ objectives: [OBJECTIVE] }),
      { organizationId: "ORG-1" },
    );
    expect(rollup.objectives).toHaveLength(1);
    expect(rollup.objectives[0]?.kind).toBe("unconcluded");
    // No observation exists, so the measure cannot be read. That is reported as
    // unreadable rather than as failure, and it names what would fix it.
    expect(rollup.objectives[0]?.blockages.at(-1)?.unblockedBy)
      .toBe("an outcome observation is recorded against the objective");
    expect(rollup.objectives[0]?.blockages.at(-1)?.ownerPrincipalId).toBe("PRN-OWNER");
  });

  it("composes the room's own conclusion rather than re-deciding it", async () => {
    const rollup = await loadOutcomeRollup(
      db({
        objectives: [OBJECTIVE],
        observations: [{
          id: "OBS-1",
          supersedesObservationId: null,
          numericValue: 30,
          narrative: null,
          measureKind: "quantitative",
          measureUnit: "days",
        }],
        links: [{ backlogItemId: "bi-row-1" }],
        rooms: [{
          capsuleId: "WC-1",
          workspaceState: {
            workroomDrive: {
              conclusion: {
                kind: "blocked",
                action: "stop",
                reason: "unreachable_substrate",
                summary: "the substrate cannot be reached",
                blockage: {
                  what: "The substrate this room reads cannot be reached.",
                  unblockedBy: "the substrate answers a read again",
                  ownerPrincipalId: "PRN-ROOM",
                  ownerSetupRequired: null,
                },
              },
            },
          },
        }],
      }),
      { organizationId: "ORG-1" },
    );

    // The measure reached its target, so the objective is met — and the stuck
    // room is still surfaced rather than hidden by the good news.
    expect(rollup.objectives[0]?.kind).toBe("outcome-met");
    expect(rollup.objectives[0]?.blockages[0]?.at).toBe("WC-1");
    expect(rollup.objectives[0]?.blockages[0]?.unblockedBy).toBe("the substrate answers a read again");
    expect(rollup.organization.kind).toBe("outcome-met");
  });

  it("does not query rooms for an objective nothing is linked to", async () => {
    const database = db({ objectives: [OBJECTIVE] });
    await loadOutcomeRollup(database, { organizationId: "ORG-1" });
    expect((database as never as { workroom: { findMany: { mock: { calls: unknown[] } } } })
      .workroom.findMany.mock.calls).toHaveLength(0);
  });

  it("excludes archived objectives at the query, so a withdrawn outcome cannot look unmet", async () => {
    const database = db();
    await loadOutcomeRollup(database, { organizationId: "ORG-1" });
    const where = (database as never as {
      productObjective: { findMany: { mock: { calls: [{ where: { status: { in: string[] } } }][] } } };
    }).productObjective.findMany.mock.calls[0][0].where;
    expect(where.status.in).not.toContain("archived");
  });

  it("refuses to answer for an organization that does not exist", async () => {
    const database = db();
    (database as never as { organization: { findUnique: unknown } }).organization = {
      findUnique: vi.fn(async () => null),
    };
    await expect(loadOutcomeRollup(database, { organizationId: "ORG-MISSING" }))
      .rejects.toThrow("nothing can be rolled up to it");
  });

  it("never invents an owner when the organization records none", async () => {
    const rollup = await loadOutcomeRollup(
      db({ objectives: [OBJECTIVE], topAccountablePrincipalId: null }),
      { organizationId: "ORG-1" },
    );
    expect(rollup.objectives[0]?.blockages.at(-1)?.ownerPrincipalId).toBeNull();
    expect(rollup.objectives[0]?.blockages.at(-1)?.ownerSetupRequired)
      .toContain("records no owner");
  });
});

import { describe, expect, it } from "vitest";

import {
  HospitalityServiceTurnVersionError,
  transitionHospitalityServiceTurn,
  type HospitalityServiceTurnFact,
} from "./hospitality-service-turn";

const startedAt = new Date("2026-07-31T18:00:00.000Z");

function turn(
  overrides: Partial<HospitalityServiceTurnFact> = {},
): HospitalityServiceTurnFact {
  return {
    id: "turn-1",
    stage: "seated",
    version: 1,
    startedAt,
    expectedEndAt: new Date("2026-07-31T19:15:00.000Z"),
    closedAt: null,
    ...overrides,
  };
}

describe("hospitality service turn lifecycle", () => {
  it("uses one versioned progression from seating through reset", () => {
    const ordered = transitionHospitalityServiceTurn(turn(), {
      expectedVersion: 1,
      stage: "ordered",
      at: new Date("2026-07-31T18:12:00.000Z"),
    });
    const paid = transitionHospitalityServiceTurn(ordered, {
      expectedVersion: 2,
      stage: "paid",
      at: new Date("2026-07-31T19:02:00.000Z"),
    });
    const dirty = transitionHospitalityServiceTurn(paid, {
      expectedVersion: 3,
      stage: "dirty",
      at: new Date("2026-07-31T19:08:00.000Z"),
    });
    const closed = transitionHospitalityServiceTurn(dirty, {
      expectedVersion: 4,
      stage: "closed",
      at: new Date("2026-07-31T19:14:00.000Z"),
    });

    expect(closed).toMatchObject({
      stage: "closed",
      version: 5,
      closedAt: new Date("2026-07-31T19:14:00.000Z"),
    });
  });

  it("allows an operator to close a turn from paid when reset is immediate", () => {
    expect(
      transitionHospitalityServiceTurn(turn({ stage: "paid", version: 3 }), {
        expectedVersion: 3,
        stage: "closed",
        at: new Date("2026-07-31T19:04:00.000Z"),
      }),
    ).toMatchObject({ stage: "closed", version: 4 });
  });

  it("rejects stale, backwards, skipped, and terminal transitions", () => {
    expect(() =>
      transitionHospitalityServiceTurn(turn(), {
        expectedVersion: 9,
        stage: "ordered",
        at: startedAt,
      })
    ).toThrow(HospitalityServiceTurnVersionError);

    expect(() =>
      transitionHospitalityServiceTurn(turn({ stage: "ordered", version: 2 }), {
        expectedVersion: 2,
        stage: "seated",
        at: startedAt,
      })
    ).toThrow("Invalid hospitality service turn transition ordered -> seated");

    expect(() =>
      transitionHospitalityServiceTurn(turn(), {
        expectedVersion: 1,
        stage: "dirty",
        at: startedAt,
      })
    ).toThrow("Invalid hospitality service turn transition seated -> dirty");

    expect(() =>
      transitionHospitalityServiceTurn(
        turn({ stage: "closed", version: 5, closedAt: startedAt }),
        {
          expectedVersion: 5,
          stage: "cancelled",
          at: startedAt,
        },
      )
    ).toThrow("Hospitality service turn turn-1 is terminal (closed)");
  });

  it("permits cancellation before payment and records closure time", () => {
    expect(
      transitionHospitalityServiceTurn(turn({ stage: "ordered", version: 2 }), {
        expectedVersion: 2,
        stage: "cancelled",
        at: new Date("2026-07-31T18:20:00.000Z"),
      }),
    ).toMatchObject({
      stage: "cancelled",
      version: 3,
      closedAt: new Date("2026-07-31T18:20:00.000Z"),
    });
  });
});

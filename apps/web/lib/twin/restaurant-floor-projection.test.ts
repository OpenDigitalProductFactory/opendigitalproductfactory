import { describe, expect, it } from "vitest";

import {
  deriveRestaurantFloor,
  projectCustomerRestaurantAvailability,
  type RestaurantFloorInput,
} from "./restaurant-floor-projection";

const NOW = new Date("2026-07-31T23:00:00.000Z");

function busyShift(): RestaurantFloorInput {
  return {
    now: NOW,
    tables: [
      {
        id: "table-1",
        label: "Table 1",
        capacity: 4,
        serviceArea: "Main dining",
        status: "active",
        attributes: {
          shape: "round",
          combinableWith: ["table-2"],
        },
      },
      {
        id: "table-2",
        label: "Table 2",
        capacity: 4,
        serviceArea: "Main dining",
        status: "active",
        attributes: {
          shape: "square",
          combinationGroup: "main-pair",
          combinableWith: ["table-1"],
        },
      },
      {
        id: "table-3",
        label: "Table 3",
        capacity: 2,
        serviceArea: "Window",
        status: "active",
        attributes: { shape: "square" },
      },
      {
        id: "table-4",
        label: "Table 4",
        capacity: 4,
        serviceArea: "Patio",
        status: "blocked",
        blockedReason: "Chair repair",
        attributes: { shape: "round" },
      },
      {
        id: "table-5",
        label: "Table 5",
        capacity: 2,
        serviceArea: "Main dining",
        status: "active",
        attributes: { shape: "round" },
      },
      {
        id: "table-6",
        label: "Table 6",
        capacity: 2,
        serviceArea: "Main dining",
        status: "active",
        attributes: { shape: "round" },
      },
      {
        id: "table-7",
        label: "Table 7",
        capacity: 4,
        serviceArea: "Window",
        status: "active",
        attributes: { shape: "booth" },
      },
      {
        id: "table-8",
        label: "Table 8",
        capacity: 4,
        serviceArea: "Main dining",
        status: "active",
        attributes: { shape: "rectangle" },
      },
    ],
    occupancies: [
      {
        tableIds: ["table-2"],
        demandId: "reservation-lee",
        stage: "ordered",
        startedAt: new Date("2026-07-31T22:10:00.000Z"),
        expectedEndAt: new Date("2026-07-31T23:35:00.000Z"),
      },
      {
        tableIds: ["table-3"],
        demandId: "reservation-ng",
        stage: "dirty",
        startedAt: new Date("2026-07-31T21:30:00.000Z"),
        expectedEndAt: new Date("2026-07-31T22:45:00.000Z"),
      },
      {
        tableIds: ["table-5", "table-6"],
        demandId: "reservation-morgan",
        stage: "seated",
        startedAt: new Date("2026-07-31T22:35:00.000Z"),
        expectedEndAt: new Date("2026-08-01T00:05:00.000Z"),
      },
      {
        tableIds: ["table-7"],
        demandId: "reservation-chen",
        stage: "paid",
        startedAt: new Date("2026-07-31T21:40:00.000Z"),
        expectedEndAt: new Date("2026-07-31T23:04:00.000Z"),
      },
      {
        tableIds: ["table-8"],
        demandId: "reservation-davis",
        stage: "seated",
        startedAt: new Date("2026-07-31T21:20:00.000Z"),
        expectedEndAt: new Date("2026-07-31T22:48:00.000Z"),
      },
    ],
    holds: [
      {
        tableId: "table-1",
        startsAt: new Date("2026-07-31T22:58:00.000Z"),
        endsAt: new Date("2026-07-31T23:08:00.000Z"),
      },
    ],
    demands: [
      {
        id: "reservation-lee",
        kind: "reservation",
        guestName: "Lee",
        guestEmail: "lee@example.com",
        guestPhone: "555-0101",
        covers: 4,
        status: "seated",
        scheduledAt: new Date("2026-07-31T22:00:00.000Z"),
        dietaryNotes: "Peanut allergy",
        vip: true,
      },
      {
        id: "walkin-rivera",
        kind: "walk-in",
        guestName: "Rivera",
        covers: 3,
        status: "waiting",
        arrivedAt: new Date("2026-07-31T22:46:00.000Z"),
      },
      {
        id: "reservation-patel",
        kind: "reservation",
        guestName: "Patel",
        covers: 2,
        status: "waiting",
        scheduledAt: new Date("2026-08-01T00:30:00.000Z"),
      },
    ],
    serverSections: [
      {
        serverId: "employee-alex",
        serverName: "Alex",
        sectionLabel: "Main dining",
        tableIds: ["table-1", "table-2", "table-5", "table-6", "table-8"],
      },
      {
        serverId: "employee-sam",
        serverName: "Sam",
        sectionLabel: "Window",
        tableIds: ["table-3", "table-7"],
      },
    ],
    upcoming: [
      {
        tableId: "table-1",
        demandId: "reservation-patel",
        startsAt: new Date("2026-08-01T00:30:00.000Z"),
        endsAt: new Date("2026-08-01T02:00:00.000Z"),
      },
    ],
  };
}

describe("deriveRestaurantFloor", () => {
  it("carries every busy-shift table state with structural and staffing context", () => {
    const floor = deriveRestaurantFloor(busyShift());

    expect(floor.tables.map((table) => [table.id, table.state])).toEqual([
      ["table-1", "held"],
      ["table-2", "ordered"],
      ["table-3", "dirty"],
      ["table-4", "blocked"],
      ["table-5", "seated"],
      ["table-6", "seated"],
      ["table-7", "paid"],
      ["table-8", "late-turn"],
    ]);
    expect(floor.tables.find((table) => table.id === "table-2")).toMatchObject({
      shape: "square",
      capacity: 4,
      serviceArea: "Main dining",
      server: { id: "employee-alex", name: "Alex", tableCount: 5 },
      party: { id: "reservation-lee", name: "Lee", covers: 4 },
    });
    expect(floor.tables.find((table) => table.id === "table-5")?.combinedWith).toEqual([
      "table-6",
    ]);
    expect(floor.tables.find((table) => table.id === "table-8")?.timing).toMatchObject({
      kind: "late",
      minutes: 12,
    });
  });

  it("explains compatibility, forward availability, and server imbalance", () => {
    const floor = deriveRestaurantFloor(busyShift());
    const rivera = floor.demand.find((party) => party.id === "walkin-rivera");

    expect(rivera).toMatchObject({
      waitedMinutes: 14,
      compatibleTableIds: ["table-1"],
      recommendation: {
        tableIds: ["table-1"],
        warning: "Alex is carrying 5 tables while Sam is carrying 2.",
      },
    });
    expect(floor.tables.find((table) => table.id === "table-1")?.availability).toEqual({
      kind: "at",
      availableAt: "2026-07-31T23:08:00.000Z",
      minutes: 8,
      reason: "Held for a booking in progress",
    });
    expect(floor.tables.find((table) => table.id === "table-2")?.availability).toEqual({
      kind: "at",
      availableAt: "2026-07-31T23:35:00.000Z",
      minutes: 35,
      reason: "Current party is still dining",
    });
  });

  it("uses text states and honest unknown staffing instead of inventing coverage", () => {
    const input = busyShift();
    input.serverSections = [];
    const floor = deriveRestaurantFloor(input);

    expect(floor.tables.find((table) => table.id === "table-1")?.statusLabel).toBe(
      "Held",
    );
    expect(floor.tables.every((table) => table.server == null)).toBe(true);
    expect(floor.staffingAvailable).toBe(false);
  });

  it("recommends a configured table pair when no single table fits", () => {
    const floor = deriveRestaurantFloor({
      now: NOW,
      tables: [
        {
          id: "table-a",
          label: "Table A",
          capacity: 2,
          serviceArea: "Main",
          status: "active",
          attributes: {
            shape: "square",
            combinationGroup: "pair-a",
            combinableWith: [],
          },
        },
        {
          id: "table-b",
          label: "Table B",
          capacity: 2,
          serviceArea: "Main",
          status: "active",
          attributes: {
            shape: "square",
            combinationGroup: "pair-a",
            combinableWith: [],
          },
        },
      ],
      occupancies: [],
      holds: [],
      upcoming: [],
      demands: [
        {
          id: "walkin-four",
          kind: "walk-in",
          guestName: "Party of four",
          covers: 4,
          status: "waiting",
          arrivedAt: new Date("2026-07-31T22:55:00.000Z"),
        },
      ],
      serverSections: [
        {
          serverId: "employee-a",
          serverName: "Jordan",
          sectionLabel: "Main",
          tableIds: ["table-a", "table-b"],
        },
      ],
    });

    expect(floor.demand[0]).toMatchObject({
      compatibleTableIds: ["table-a", "table-b"],
      recommendation: {
        tableIds: ["table-a", "table-b"],
        reason: "Table A + Table B fit 4 and are open now.",
      },
    });
  });
});

describe("projectCustomerRestaurantAvailability", () => {
  it("allow-lists capacity and timing without leaking guest, staff, or internal notes", () => {
    const customer = projectCustomerRestaurantAvailability(
      deriveRestaurantFloor(busyShift()),
    );
    const serialized = JSON.stringify(customer);

    expect(customer.tables[0]).toEqual({
      key: "availability-1",
      capacity: 4,
      shape: "round",
      serviceArea: "Main dining",
      availability: {
        kind: "at",
        availableAt: "2026-07-31T23:08:00.000Z",
        minutes: 8,
        explanation: "Available in about 8 minutes",
      },
    });
    for (const secret of [
      "Lee",
      "Rivera",
      "Patel",
      "Alex",
      "Sam",
      "employee-alex",
      "lee@example.com",
      "555-0101",
      "Peanut allergy",
      "VIP",
      "Chair repair",
      "server imbalance",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("keeps customer and operator availability counts reconciled", () => {
    const operator = deriveRestaurantFloor(busyShift());
    const customer = projectCustomerRestaurantAvailability(operator);

    expect(customer.summary.totalTables).toBe(operator.tables.length);
    expect(customer.summary.availableNow).toBe(
      operator.tables.filter((table) => table.availability.kind === "now").length,
    );
  });
});

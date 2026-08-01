// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RestaurantFloorOperationsProps } from "./RestaurantFloorOperations";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  advance: vi.fn(),
  move: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/lib/twin/restaurant-floor-actions", () => ({
  executeRestaurantFloorCommand: mocks.execute,
  advanceRestaurantServiceTurn: mocks.advance,
  moveRestaurantParty: mocks.move,
}));

vi.mock("@/components/twin/cartesian/CartesianSceneCanvas", () => ({
  CartesianSceneCanvas: () => <div>interactive floor canvas</div>,
}));

import { RestaurantFloorOperations } from "./RestaurantFloorOperations";

const props: RestaurantFloorOperationsProps = {
  scene: null,
  view: {
    floor: {
      asOf: "2026-07-31T18:14:00.000Z",
      staffingAvailable: true,
      tables: [
        {
          id: "table-1",
          label: "Table 1",
          capacity: 2,
          serviceArea: "Main dining",
          shape: "square",
          combinableWith: [],
          combinationGroup: "main",
          combinedWith: [],
          state: "available",
          statusLabel: "Available",
          blockedReason: null,
          timing: null,
          availability: {
            kind: "now",
            availableAt: "2026-07-31T18:14:00.000Z",
            minutes: 0,
            reason: "Available for seating now",
          },
          party: null,
          turn: null,
          server: {
            id: "assignment-1",
            name: "Jordan Rivera",
            sectionLabel: "Main dining",
            tableCount: 3,
          },
        },
      ],
      demand: [
        {
          id: "booking-waiting",
          kind: "walk-in",
          name: "Alex Kim",
          covers: 2,
          waitedMinutes: 14,
          scheduledAt: "2026-07-31T18:14:00.000Z",
          hasDietaryNote: true,
          vip: false,
          compatibleTableIds: ["table-1"],
          recommendation: {
            tableIds: ["table-1"],
            reason: "Table 1 fits 2 and is open now.",
            warning: null,
          },
        },
      ],
    },
    commands: [
      {
        demandId: "booking-waiting",
        options: [
          {
            resourceIds: ["table-1"],
            label: "Table 1",
            expectedVersion: "restaurant-seat.v1-current",
            interval: {
              startsAt: "2026-07-31T18:14:00.000Z",
              endsAt: "2026-07-31T19:14:00.000Z",
            },
          },
        ],
      },
    ],
    moves: [],
    telemetry: {
      durationMs: 12.5,
      queryCount: 6,
      payloadBytes: 2_048,
    },
  },
};

describe("RestaurantFloorOperations", () => {
  afterEach(cleanup);

  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.advance.mockReset();
    mocks.move.mockReset();
    mocks.refresh.mockReset();
    mocks.execute.mockResolvedValue({
      status: "confirmed",
      idempotencyKey: "seat-key",
      replayed: false,
      newVersion: "restaurant-turn:HT-1:1",
      changedFacts: [
        { entityId: "booking-waiting", field: "status", value: "seated" },
        {
          entityId: "booking-waiting",
          field: "resourceIds",
          value: "table-1",
        },
      ],
    });
    mocks.advance.mockResolvedValue({
      status: "confirmed",
      idempotencyKey: "turn-paid-key",
      replayed: false,
      newVersion: "restaurant-turn:HT-1:3",
      changedFacts: [
        { entityId: "turn-1", field: "stage", value: "paid" },
      ],
    });
    mocks.move.mockResolvedValue({
      status: "confirmed",
      idempotencyKey: "move-key",
      replayed: false,
      newVersion: "restaurant-turn:HT-1:3",
      changedFacts: [
        { entityId: "turn-1", field: "resourceIds", value: "table-2" },
      ],
    });
  });

  it("provides equivalent list controls for selecting and confirming a table", async () => {
    render(<RestaurantFloorOperations {...props} />);

    expect(screen.getByText(/waiting 14 min/)).toBeTruthy();
    expect(screen.getAllByText("Jordan Rivera").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Available").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Alex Kim/i }));
    fireEvent.click(screen.getByRole("button", { name: "Choose" }));

    expect(screen.getByText(/Seat Alex Kim \(2\) at Table 1/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm seating" }),
    );

    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: "restaurant-seat.v1-current",
        entityRefs: {
          demandId: "booking-waiting",
          resourceIds: ["table-1"],
        },
      }),
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(screen.getByText("Party seated")).toBeTruthy();
  });

  it("keeps compatibility and assignment state in text, not color alone", () => {
    render(<RestaurantFloorOperations {...props} />);

    expect(screen.getByText("Available")).toBeTruthy();
    expect(screen.getByText("Available for seating now")).toBeTruthy();
    expect(screen.getByText("Walk-in")).toBeTruthy();
    expect(screen.getByText("3 tables")).toBeTruthy();
  });

  it("advances an occupied table through the service lifecycle", async () => {
    const occupiedProps: RestaurantFloorOperationsProps = {
      ...props,
      view: {
        ...props.view,
        floor: {
          ...props.view.floor,
          demand: [],
          tables: [
            {
              ...props.view.floor.tables[0],
              state: "ordered",
              statusLabel: "Ordered",
              availability: {
                kind: "at",
                availableAt: "2026-07-31T19:14:00.000Z",
                minutes: 60,
                reason: "Current party is still dining",
              },
              party: {
                id: "booking-seated",
                name: "Morgan Lee",
                covers: 2,
              },
              turn: {
                id: "turn-1",
                turnId: "HT-1",
                stage: "ordered",
                version: 2,
              },
            },
            {
              ...props.view.floor.tables[0],
              id: "table-2",
              label: "Table 2",
              party: null,
              turn: null,
            },
          ],
        },
        commands: [],
        moves: [
          {
            demandId: "booking-seated",
            serviceTurnId: "turn-1",
            expectedTurnVersion: 2,
            options: [
              {
                resourceIds: ["table-2"],
                label: "Table 2",
                expectedVersion: "restaurant-seat.v1-move",
                interval: {
                  startsAt: "2026-07-31T18:14:00.000Z",
                  endsAt: "2026-07-31T19:14:00.000Z",
                },
              },
            ],
          },
        ],
      },
    };

    render(<RestaurantFloorOperations {...occupiedProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark paid" }));

    await waitFor(() => expect(mocks.advance).toHaveBeenCalledTimes(1));
    expect(mocks.advance).toHaveBeenCalledWith({
      idempotencyKey: expect.stringMatching(/^turn:turn-1:paid:/),
      serviceTurnId: "turn-1",
      expectedVersion: 2,
      stage: "paid",
    });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(screen.getByText("Table status updated")).toBeTruthy();
  });

  it("previews and confirms moving an active party to a compatible table", async () => {
    const moveProps: RestaurantFloorOperationsProps = {
      ...props,
      view: {
        ...props.view,
        floor: {
          ...props.view.floor,
          demand: [],
          tables: [
            {
              ...props.view.floor.tables[0],
              state: "seated",
              statusLabel: "Seated",
              party: {
                id: "booking-seated",
                name: "Morgan Lee",
                covers: 2,
              },
              turn: {
                id: "turn-1",
                turnId: "HT-1",
                stage: "seated",
                version: 2,
              },
            },
            {
              ...props.view.floor.tables[0],
              id: "table-2",
              label: "Table 2",
              party: null,
              turn: null,
            },
          ],
        },
        commands: [],
        moves: [
          {
            demandId: "booking-seated",
            serviceTurnId: "turn-1",
            expectedTurnVersion: 2,
            options: [
              {
                resourceIds: ["table-2"],
                label: "Table 2",
                expectedVersion: "restaurant-seat.v1-move",
                interval: {
                  startsAt: "2026-07-31T18:14:00.000Z",
                  endsAt: "2026-07-31T19:14:00.000Z",
                },
              },
            ],
          },
        ],
      },
    };

    render(<RestaurantFloorOperations {...moveProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Move party" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Move to Table 2" }),
    );
    expect(screen.getByText(/Move Morgan Lee to Table 2/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm move" }));

    await waitFor(() => expect(mocks.move).toHaveBeenCalledTimes(1));
    expect(mocks.move).toHaveBeenCalledWith({
      idempotencyKey: expect.stringMatching(/^move:turn-1:/),
      serviceTurnId: "turn-1",
      expectedTurnVersion: 2,
      expectedSeatingVersion: "restaurant-seat.v1-move",
      interval: {
        startsAt: "2026-07-31T18:14:00.000Z",
        endsAt: "2026-07-31T19:14:00.000Z",
      },
      resourceIds: ["table-2"],
    });
  });
});

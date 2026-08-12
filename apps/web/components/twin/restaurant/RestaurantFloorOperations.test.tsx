// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

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
  canvasProps: null as Record<string, unknown> | null,
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
  CartesianSceneCanvas: (canvasProps: Record<string, unknown>) => {
    mocks.canvasProps = canvasProps;
    return (
      <div
        data-testid="restaurant-floor-canvas"
        data-chrome={String(canvasProps.chrome)}
        data-navigation={String(canvasProps.navigation)}
      >
        interactive floor canvas
      </div>
    );
  },
}));

import { RestaurantFloorOperations } from "./RestaurantFloorOperations";

const props: RestaurantFloorOperationsProps = {
  scene: {
    id: "scene-1",
    version: 1,
    createdFromStarter: false,
    layout: {
      schemaVersion: 1,
      spaceKind: "cartesian-interior",
      viewport: { x: 0, y: 0, zoom: 1 },
      zones: [],
      placements: [
        {
          id: "table-placement-1",
          label: "Table 1",
          entityRef: { kind: "table", id: "table-1" },
          geometry: {
            x: 20,
            y: 20,
            width: 72,
            height: 72,
            rotation: 0,
            shapeKind: "square-table",
          },
        },
      ],
    },
  },
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
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.advance.mockReset();
    mocks.move.mockReset();
    mocks.refresh.mockReset();
    mocks.canvasProps = null;
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

  it("bounds the desktop pressure-mode console while preserving document flow below desktop", () => {
    render(
      <RestaurantFloorOperations
        {...props}
        serviceAttention={<div>Takeout order needs confirmation</div>}
      />,
    );

    const console = screen.getByTestId("restaurant-host-command-center");
    expect(console).toHaveAttribute("data-dpf-density", "compact");
    expect(console.className).toContain("overflow-visible");
    expect(console.className).toContain("lg:overflow-hidden");
    expect(screen.getByTestId("restaurant-host-workspace")).toHaveStyle({
      gridTemplateColumns:
        "repeat(auto-fit, minmax(min(100%, 28rem), 1fr))",
    });
    expect(screen.getByRole("heading", { name: "Host stand" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Waiting now" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "AI host recommends" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Floor" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Table list" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryByRole("heading", { name: "All tables" })).toBeNull();
    expect(
      screen.getByText("Orders, calls and messages"),
    ).toBeTruthy();
    expect(screen.getByText("Takeout order needs confirmation")).toBeTruthy();
  });

  it("locks embedded floor navigation so table activation wins over canvas movement", () => {
    render(<RestaurantFloorOperations {...props} />);

    expect(screen.getByTestId("restaurant-floor-canvas")).toHaveAttribute(
      "data-chrome",
      "embedded",
    );
    expect(screen.getByTestId("restaurant-floor-canvas")).toHaveAttribute(
      "data-navigation",
      "locked",
    );
    const bindings = mocks.canvasProps?.bindings as Record<
      string,
      { sublabel?: string }
    >;
    expect(bindings["table:table-1"]?.sublabel).toBe(
      "2 seats · Jordan Rivera",
    );
  });

  it("uses coworker ranking to prepare the next safe seating confirmation", () => {
    render(<RestaurantFloorOperations {...props} />);

    expect(screen.getByText("Table 1 fits 2 and is open now.")).toBeTruthy();
    expect(screen.getByText(/Seat Alex Kim \(2\) at Table 1/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm seating" })).toHaveAttribute(
      "data-owner-first-next-action",
      "restaurant-confirm-seating",
    );
  });

  it("keeps late reservations and their held capacity visible during service", () => {
    render(
      <RestaurantFloorOperations
        {...props}
        view={{
          ...props.view,
          reservationWatch: [
            {
              id: "reservation-late",
              name: "Taylor Morgan",
              covers: 4,
              scheduledAt: "2026-07-31T18:04:00.000Z",
              lateMinutes: 10,
              state: "late",
              tableLabels: ["Table 4"],
            },
          ],
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Reservations to watch" }),
    ).toBeTruthy();
    expect(screen.getByText(/Taylor Morgan · 4 guests/)).toBeTruthy();
    expect(screen.getByText(/holding Table 4/)).toBeTruthy();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(screen.getByText("10 min late")).toBeTruthy();
  });

  it("switches the center pane between the floor and the equivalent table list", () => {
    render(<RestaurantFloorOperations {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Table list" }));
    expect(screen.queryByTestId("restaurant-floor-canvas")).toBeNull();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Floor" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("provides equivalent list controls for selecting and confirming a table", async () => {
    render(<RestaurantFloorOperations {...props} />);

    expect(screen.getByText(/waiting 14 min/)).toBeTruthy();
    expect(screen.getAllByText("Jordan Rivera").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Table list" }));
    expect(screen.getAllByText("Available").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Selected" })).toBeTruthy();

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

  it("refreshes the floor and clears stale seating choices after a conflict", async () => {
    mocks.execute.mockResolvedValueOnce({
      status: "conflict",
      idempotencyKey: "seat-conflict",
      replayed: false,
      message: "The floor changed before confirmation.",
      currentVersion: "restaurant-seat.v1-newer",
      changedFacts: [],
    });

    render(<RestaurantFloorOperations {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm seating" }));

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.textContent).toContain("Floor changed before confirmation");
    expect(alert.textContent).toContain("Review the refreshed choices and confirm again");
    expect(document.activeElement).toBe(alert);
    expect(screen.queryByRole("button", { name: "Confirm seating" })).toBeNull();
    expect(screen.getByText("Choose a party to see the safest live seating choice.")).toBeTruthy();
  });

  it("submits host commands when randomUUID is unavailable on an HTTP install", async () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(7),
    });

    render(<RestaurantFloorOperations {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm seating" }));

    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^seat:booking-waiting:\d+:/),
      }),
    );
  });

  it("keeps compatibility and assignment state in text, not color alone", () => {
    render(<RestaurantFloorOperations {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Table list" }));
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
    const moveOption = screen.getByRole("button", { name: "Move to Table 2" });
    expect(moveOption.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(moveOption);
    expect(moveOption.getAttribute("aria-pressed")).toBe("true");
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

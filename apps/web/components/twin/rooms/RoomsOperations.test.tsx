/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDemoRoomsOperationalView } from "@/lib/twin/rooms-operations-demo";

vi.mock("@/components/twin/cartesian/CartesianSceneCanvas", () => ({
  CartesianSceneCanvas: (props: { ariaLabel: string }) => (
    <div aria-label={props.ariaLabel}>room floor canvas</div>
  ),
}));

import { RoomsOperations } from "./RoomsOperations";

afterEach(cleanup);

describe("RoomsOperations", () => {
  it("defaults to a scan-first room rack with independent state labels", () => {
    render(
      <RoomsOperations
        view={buildDemoRoomsOperationalView({ domain: "lodging" })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Rooms now" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Room rack" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Ready by check-in")).toBeVisible();
    expect(screen.getAllByText("Occupied").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dirty").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sellable").length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Needs attention" })).toBeVisible();
  });

  it("keeps floor and semantic list synchronized with room selection", () => {
    render(
      <RoomsOperations
        view={buildDemoRoomsOperationalView({ domain: "lodging" })}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Floor & wing" }));
    expect(screen.getByLabelText("Room floor and wing layout")).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Accessible list" }));
    expect(screen.getByRole("table", { name: "Room operations" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Occupancy" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Readiness" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Inventory" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Open Room 101 details/i }));
    expect(screen.getByRole("region", { name: "Room 101 details" })).toBeVisible();
  });

  it("uses privacy-safe care vocabulary and never renders occupant identity", () => {
    render(
      <RoomsOperations
        view={buildDemoRoomsOperationalView({ domain: "care" })}
      />,
    );

    expect(screen.getByText("Care rooms now")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/patient name|diagnosis/i);
  });
});

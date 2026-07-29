// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { restaurantBusyShiftFixture } from "@/lib/twin/__fixtures__/restaurant-busy-shift";

import { ResourceUnitGrid } from "./ResourceUnit";

afterEach(cleanup);

describe("ResourceUnitGrid", () => {
  it("exposes the same physical resources as an accessible list", () => {
    const units = restaurantBusyShiftFixture().zones[0].units;
    render(<ResourceUnitGrid units={units} />);

    expect(screen.getByRole("list", { name: "Resources" })).not.toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(units.length);
    expect(screen.getByText("Table 1")).not.toBeNull();
    expect(screen.getByText("Tables 5 + 6")).not.toBeNull();
    expect(screen.getByText("Dirty")).not.toBeNull();
    expect(screen.getByText("Blocked")).not.toBeNull();
  });
});

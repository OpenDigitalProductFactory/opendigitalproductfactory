import React from "react";
import { render } from "@testing-library/react-native";
import { DashboardTile } from "./DashboardTile";
import type { DashboardTile as TileType } from "@dpf/types";

describe("DashboardTile", () => {
  const baseTile: TileType = {
    area: "Ops",
    label: "Open Items",
    value: 12,
  };

  it("renders area, value, and label", () => {
    const { getByText } = render(<DashboardTile tile={baseTile} />);
    expect(getByText("Ops")).toBeTruthy();
    expect(getByText("12")).toBeTruthy();
    expect(getByText("Open Items")).toBeTruthy();
  });

  it("renders up trend indicator", () => {
    const tile: TileType = { ...baseTile, trend: "up" };
    const { getByText } = render(<DashboardTile tile={tile} />);
    expect(getByText("\u2191")).toBeTruthy();
  });

  it("renders down trend indicator", () => {
    const tile: TileType = { ...baseTile, trend: "down" };
    const { getByText } = render(<DashboardTile tile={tile} />);
    expect(getByText("\u2193")).toBeTruthy();
  });

  it("renders stable trend indicator", () => {
    const tile: TileType = { ...baseTile, trend: "stable" };
    const { getByText } = render(<DashboardTile tile={tile} />);
    expect(getByText("\u2192")).toBeTruthy();
  });

  it("does not render trend when none provided", () => {
    const { queryByText } = render(<DashboardTile tile={baseTile} />);
    expect(queryByText("\u2191")).toBeNull();
    expect(queryByText("\u2193")).toBeNull();
    expect(queryByText("\u2192")).toBeNull();
  });

  it("renders without crashing when value is zero", () => {
    const tile: TileType = { ...baseTile, value: 0 };
    const { getByText } = render(<DashboardTile tile={tile} />);
    expect(getByText("0")).toBeTruthy();
  });
});

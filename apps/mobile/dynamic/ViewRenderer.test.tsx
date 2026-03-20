import React from "react";
import { render } from "@testing-library/react-native";
import { ViewRenderer } from "./ViewRenderer";
import type { DynamicViewSchema } from "@dpf/types";

const baseSchema: DynamicViewSchema = {
  viewId: "test-view-1",
  title: "Dashboard",
  type: "dashboard",
  dataSource: "/api/v1/data",
  layout: [
    { widget: "stat-card", dataKey: "totalOrders", label: "Total Orders" },
    {
      widget: "bar-chart",
      dataKey: "monthlySales",
      label: "Monthly Sales",
    },
    {
      widget: "list",
      dataKey: "recentItems",
      label: "Recent Items",
      columns: ["name", "status"],
    },
    { widget: "map", dataKey: "locations", label: "Locations" },
  ],
};

const testData: Record<string, unknown> = {
  totalOrders: 142,
  monthlySales: [
    { label: "Jan", value: 30 },
    { label: "Feb", value: 45 },
    { label: "Mar", value: 67 },
  ],
  recentItems: [
    { name: "Item A", status: "open" },
    { name: "Item B", status: "done" },
  ],
  locations: [
    { lat: 51.5, lng: -0.1 },
    { lat: 48.8, lng: 2.3 },
  ],
};

describe("ViewRenderer", () => {
  it("renders the title", () => {
    const { getByText } = render(
      <ViewRenderer schema={baseSchema} data={testData} />,
    );
    expect(getByText("Dashboard")).toBeTruthy();
  });

  it("renders correct widget for each type", () => {
    const { getByText } = render(
      <ViewRenderer schema={baseSchema} data={testData} />,
    );
    // Stat card
    expect(getByText("142")).toBeTruthy();
    expect(getByText("Total Orders")).toBeTruthy();
    // Bar chart
    expect(getByText("Monthly Sales")).toBeTruthy();
    // List
    expect(getByText("Recent Items")).toBeTruthy();
    expect(getByText("Item A")).toBeTruthy();
    // Map
    expect(getByText("Map View")).toBeTruthy();
    expect(getByText("2 markers")).toBeTruthy();
  });

  it("passes data correctly to stat card", () => {
    const { getByTestId } = render(
      <ViewRenderer schema={baseSchema} data={testData} />,
    );
    expect(getByTestId("stat-totalOrders").props.children).toBe("142");
  });

  it("shows loading state", () => {
    const { getByTestId, queryByText } = render(
      <ViewRenderer schema={baseSchema} data={{}} isLoading />,
    );
    expect(getByTestId("view-loading")).toBeTruthy();
    expect(queryByText("Dashboard")).toBeNull();
  });

  it("handles unknown widget types gracefully", () => {
    const schema: DynamicViewSchema = {
      ...baseSchema,
      layout: [
        {
          widget: "unknown-widget" as any,
          dataKey: "x",
          label: "Unknown",
        },
        {
          widget: "stat-card",
          dataKey: "totalOrders",
          label: "Total Orders",
        },
      ],
    };
    const { getByText, queryByText } = render(
      <ViewRenderer schema={schema} data={testData} />,
    );
    expect(getByText("Total Orders")).toBeTruthy();
    expect(queryByText("Unknown")).toBeNull();
  });

  it("shows placeholder text when data is missing", () => {
    const schema: DynamicViewSchema = {
      ...baseSchema,
      layout: [
        {
          widget: "stat-card",
          dataKey: "missing",
          label: "Missing Stat",
        },
      ],
    };
    const { getByText } = render(
      <ViewRenderer schema={schema} data={{}} />,
    );
    expect(getByText("--")).toBeTruthy();
  });
});

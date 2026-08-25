// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TopToolsTable } from "./TopToolsTable";

describe("TopToolsTable", () => {
  it("renders tool values in the shared table with semantic success states", () => {
    render(
      <TopToolsTable
        rows={[
          { toolName: "registry_read", count: 12, successRate: 1 },
          { toolName: "sandbox_execute", count: 3, successRate: 0.5 },
        ]}
      />,
    );

    expect(screen.getByRole("table", { name: "Top tools" })).toBeTruthy();
    expect(screen.getByText("registry_read")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("100.0%").closest("[data-intent]")?.getAttribute("data-intent")).toBe("success");
    expect(screen.getByText("50.0%").closest("[data-intent]")?.getAttribute("data-intent")).toBe("danger");
  });
});

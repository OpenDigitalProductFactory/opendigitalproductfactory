// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EnvironmentStatusSummary } from "./EnvironmentStatusSummary";

describe("EnvironmentStatusSummary", () => {
  it("shows shared environment readiness without raw trace details", () => {
    render(
      <EnvironmentStatusSummary
        activeCandidate={{ status: "available", url: "http://localhost:53601" }}
        localIntegration={{ status: "passed", summary: "Merged with origin/main and build passed." }}
      />,
    );

    expect(screen.getByText("Environment readiness")).toBeInTheDocument();
    expect(screen.getByText("Shared environment ready")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open environment" })).toHaveAttribute("href", "http://localhost:53601");
    expect(screen.getByText("Merged with origin/main and build passed.")).toBeInTheDocument();
    expect(screen.queryByText(/mcp/i)).toBeNull();
    expect(screen.queryByText(/lease/i)).toBeNull();
    expect(screen.queryByText(/localhost:53601/i)).toBeNull();
  });
});

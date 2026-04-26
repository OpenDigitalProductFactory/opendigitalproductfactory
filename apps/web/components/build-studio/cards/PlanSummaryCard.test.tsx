// @vitest-environment jsdom
import "../test-setup";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlanSummaryCard } from "./PlanSummaryCard";

describe("PlanSummaryCard", () => {
  it("renders all five plan items and the drill-in footer button", () => {
    render(<PlanSummaryCard onDrill={() => {}} />);
    expect(screen.getByText(/The plan/i)).toBeInTheDocument();
    expect(
      screen.getByText("Add a way to expire & revoke keys safely"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Build the rotate action with a 60-second grace window"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Add tests covering the happy path and edge cases"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Wire it into the Settings → API Keys screen"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Record every rotation in the audit log"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /see the technical plan/i }),
    ).toBeInTheDocument();
  });

  it("invokes onDrill when the footer button is clicked", () => {
    const onDrill = vi.fn();
    render(<PlanSummaryCard onDrill={onDrill} />);
    fireEvent.click(screen.getByRole("button", { name: /see the technical plan/i }));
    expect(onDrill).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
import "./test-setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StepTracker } from "./StepTracker";
import { DEMO_STEPS } from "@/lib/build-studio-demo";

describe("StepTracker", () => {
  it("renders all five steps with their package-delivery labels", () => {
    render(<StepTracker steps={DEMO_STEPS} />);
    expect(screen.getByText("Understanding")).toBeInTheDocument();
    expect(screen.getByText("Planning")).toBeInTheDocument();
    expect(screen.getByText("Building")).toBeInTheDocument();
    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.getByText("Handover")).toBeInTheDocument();
  });

  it("shows progress fragment for the active step", () => {
    render(<StepTracker steps={DEMO_STEPS} />);
    expect(screen.getByText(/4 of 6/)).toBeInTheDocument();
  });

  it("renders the verb line in plain English (no jargon)", () => {
    render(<StepTracker steps={DEMO_STEPS} />);
    expect(screen.getByText(/We figured out what you want/)).toBeInTheDocument();
  });
});

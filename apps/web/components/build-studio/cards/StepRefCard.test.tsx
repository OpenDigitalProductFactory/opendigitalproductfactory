// @vitest-environment jsdom
import "../test-setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StepRefCard } from "./StepRefCard";
import { DEMO_STEPS } from "@/lib/build-studio-demo";

describe("StepRefCard", () => {
  it("renders 'Started Planning' when stepId is plan", () => {
    render(<StepRefCard steps={DEMO_STEPS} stepId="plan" />);
    expect(screen.getByText(/Started/i)).toBeInTheDocument();
    expect(screen.getByText("Planning")).toBeInTheDocument();
  });

  it("renders 'Started Understanding' when stepId is ideate", () => {
    render(<StepRefCard steps={DEMO_STEPS} stepId="ideate" />);
    expect(screen.getByText("Understanding")).toBeInTheDocument();
  });
});

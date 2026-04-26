// @vitest-environment jsdom
import "../test-setup";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VerificationStripCard } from "./VerificationStripCard";
import { DEMO_STORY_STEPS } from "@/lib/build-studio-demo";

describe("VerificationStripCard", () => {
  it("renders the working count pill derived from steps", () => {
    render(<VerificationStripCard steps={DEMO_STORY_STEPS} onDrill={() => {}} />);
    expect(screen.getByText(/4 of 6 working/i)).toBeInTheDocument();
  });

  it("renders one cell per step with a data-status attribute", () => {
    render(<VerificationStripCard steps={DEMO_STORY_STEPS} onDrill={() => {}} />);
    const cells = screen.getAllByTestId("verification-strip-cell");
    expect(cells).toHaveLength(6);
    expect(cells[0]).toHaveAttribute("data-status", "passed");
    expect(cells[4]).toHaveAttribute("data-status", "running");
    expect(cells[5]).toHaveAttribute("data-status", "queued");
  });

  it("invokes onDrill when 'See screenshots' is clicked", () => {
    const onDrill = vi.fn();
    render(<VerificationStripCard steps={DEMO_STORY_STEPS} onDrill={onDrill} />);
    fireEvent.click(screen.getByRole("button", { name: /see screenshots/i }));
    expect(onDrill).toHaveBeenCalledTimes(1);
  });
});

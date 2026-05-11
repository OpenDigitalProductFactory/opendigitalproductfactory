// @vitest-environment jsdom
import "./test-setup";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BuildStudioV2 } from "./BuildStudioV2";
import { DEMO_BUSINESS_BRIEF } from "@/lib/build-studio-demo";

describe("BuildStudioV2", () => {
  it("renders the header, step tracker, conversation pane, and artifact pane", () => {
    render(<BuildStudioV2 />);
    expect(screen.getAllByText(/Tenant API key rotation/).length).toBeGreaterThan(0);
    // "Understanding" appears in both the StepTracker and the StepRefCard echo;
    // assert at least one occurrence renders.
    expect(screen.getAllByText("Understanding").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/your build assistant/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /preview/i })).toBeInTheDocument();
  });

  it("switches the artifact pane when a card drill button is clicked", async () => {
    render(<BuildStudioV2 />);
    const btn = screen.getByRole("button", { name: /see screenshots/i });
    fireEvent.click(btn);
    expect(await screen.findByText(/coming in slice 3/i)).toBeInTheDocument();
    expect(screen.queryByText(/sandbox.dpf.local/)).not.toBeInTheDocument();
  });

  it("renders a supplied business brief instead of the demo brief", () => {
    render(
      <BuildStudioV2
        businessBrief={{
          ...DEMO_BUSINESS_BRIEF,
          title: "Real persisted business brief",
          businessOutcome: "Show the actual accepted brief from the build record.",
        }}
      />,
    );

    expect(screen.getByText("Real persisted business brief")).toBeInTheDocument();
    expect(screen.getByText("Show the actual accepted brief from the build record.")).toBeInTheDocument();
    expect(screen.queryByText(DEMO_BUSINESS_BRIEF.businessOutcome)).not.toBeInTheDocument();
  });
});

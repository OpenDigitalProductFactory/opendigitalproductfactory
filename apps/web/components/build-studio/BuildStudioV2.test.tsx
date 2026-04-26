// @vitest-environment jsdom
import "./test-setup";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BuildStudioV2 } from "./BuildStudioV2";

describe("BuildStudioV2", () => {
  it("renders the header, step tracker, conversation pane, and artifact pane", () => {
    render(<BuildStudioV2 />);
    expect(screen.getByText(/Tenant API key rotation/)).toBeInTheDocument();
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
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CapabilityCompletenessPanel } from "./CapabilityCompletenessPanel";
import { CAPABILITY_PLANES } from "@/lib/coworker-lifecycle/capability-completeness";

describe("CapabilityCompletenessPanel", () => {
  afterEach(() => cleanup());

  it("renders all seven planes, including absent ones", () => {
    render(<CapabilityCompletenessPanel agentId="compliance-officer" />);
    for (const plane of CAPABILITY_PLANES) {
      expect(screen.getByTestId(`plane-${plane}`)).toBeTruthy();
    }
  });

  it("shows corpus reachability closed after the class-wide grant repair", () => {
    // The completeness ratchet closes this gap for every canonical registry
    // identity, including declared-only agents, rather than preserving one as
    // a UI fixture for a defect that no longer exists.
    render(<CapabilityCompletenessPanel agentId="policy-enforcement-agent" />);
    const corpus = screen.getByTestId("plane-corpus").textContent ?? "";
    expect(corpus).toContain("3/3");
    expect(corpus).not.toContain("registry_read");
  });

  it("shows a platform-capped plane as capped, not as an agent failure", () => {
    // Shape was the example of a plane with NO substrate (ceiling 0, rendered
    // "no substrate"). The work-shape registry landed and the ceiling rose to
    // 2, so the expectation moves up rather than being deleted: an agent that
    // has reached the platform's ceiling must read as at-ceiling, never as a
    // shortfall. The ceiling-0 branch stays for the next plane that has none.
    render(<CapabilityCompletenessPanel agentId="compliance-officer" />);
    const shape = screen.getByTestId("plane-shape").textContent ?? "";
    expect(shape).toContain("2/2");
    expect(shape).not.toContain("no substrate");
  });

  it("shows the graded level against its ceiling, not a pass/fail chip", () => {
    render(<CapabilityCompletenessPanel agentId="compliance-officer" />);
    expect(screen.getByTestId("plane-corpus").textContent).toMatch(/\d\/\d/);
  });

  it("resolves an agent by any handle it answers to", () => {
    render(<CapabilityCompletenessPanel agentId="coo-orchestrator" />);
    expect(screen.getByTestId("plane-identity")).toBeTruthy();
  });

  it("explains itself when the identity is in no namespace", () => {
    render(<CapabilityCompletenessPanel agentId="external-coding-agent" />);
    expect(screen.getByText(/Not measured/)).toBeTruthy();
  });
});

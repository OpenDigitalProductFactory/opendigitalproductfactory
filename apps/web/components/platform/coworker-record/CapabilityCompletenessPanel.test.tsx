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

  it("surfaces the missing grant on a reachability gap", () => {
    // compliance-officer used to be the example here; the grant landed
    // (BI-728FD7F2), so this now uses a declared-only agent that still cannot
    // reach its corpus. The panel must name the grant, not merely mark a gap.
    render(<CapabilityCompletenessPanel agentId="policy-enforcement-agent" />);
    expect(screen.getByTestId("plane-corpus").textContent).toContain("registry_read");
  });

  it("shows a plane with no substrate as capped, not as an agent failure", () => {
    render(<CapabilityCompletenessPanel agentId="compliance-officer" />);
    expect(screen.getByTestId("plane-shape").textContent).toContain("no substrate");
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

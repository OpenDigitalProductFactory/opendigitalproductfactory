// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentInfo } from "@/lib/agent-coworker-types";

const getProactivityPreference = vi.fn();

vi.mock("@/lib/actions/proactivity", () => ({
  getCoworkerProactivityPreference: (agentId: string) => getProactivityPreference(agentId),
}));

import { CoworkerProfilePanel } from "./CoworkerProfilePanel";

afterEach(() => {
  cleanup();
  getProactivityPreference.mockReset();
});

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    agentId: "dispatch-coworker",
    agentName: "Dispatch coworker",
    agentDescription: "Coordinates schedule-sensitive service work.",
    canAssist: true,
    sensitivity: "internal",
    systemPrompt: "You coordinate dispatch work.",
    skills: [],
    ...overrides,
  };
}

describe("CoworkerProfilePanel", () => {
  it("shows the effective proactivity plan and boundaries", () => {
    getProactivityPreference.mockResolvedValue(null);
    render(<CoworkerProfilePanel agent={makeAgent()} onClose={vi.fn()} />);

    // Two "Proactivity" texts are expected since EP-26E528F5: the section
    // header plus the shared editable control's own label.
    expect(screen.getAllByText("Proactivity").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Balanced").length).toBeGreaterThan(0);
    expect(screen.getByText(/Balanced is the default proactivity level/i)).toBeTruthy();
    expect(screen.getByText(/Monitoring: Standard/i)).toBeTruthy();
    expect(screen.getByText(/Approval: Asks first/i)).toBeTruthy();
    expect(screen.queryByText(/Spend: standard/i)).toBeNull();
    expect(screen.queryByText(/Boundary: propose/i)).toBeNull();
    expect(screen.queryByText(/proactivity:scheduled-task:balanced/i)).toBeNull();
  });

  it("loads the saved coworker proactivity preference for the profile summary", async () => {
    getProactivityPreference.mockResolvedValue("assertive");

    render(<CoworkerProfilePanel agent={makeAgent()} onClose={vi.fn()} />);

    expect((await screen.findAllByText("Assertive")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Stay on this/i)).toBeTruthy();
    expect(screen.queryByText(/proactivity:scheduled-task:assertive/i)).toBeNull();
  });
});

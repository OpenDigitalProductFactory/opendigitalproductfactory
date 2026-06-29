// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentInfo } from "@/lib/agent-coworker-types";

import { CoworkerProfilePanel } from "./CoworkerProfilePanel";

afterEach(() => {
  cleanup();
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
    render(<CoworkerProfilePanel agent={makeAgent()} onClose={vi.fn()} />);

    expect(screen.getByText("Proactivity")).toBeTruthy();
    expect(screen.getByText("Balanced")).toBeTruthy();
    expect(screen.getByText(/Balanced is the default proactivity level/i)).toBeTruthy();
    expect(screen.getByText(/Spend: standard/i)).toBeTruthy();
    expect(screen.getByText(/Boundary: propose/i)).toBeTruthy();
  });
});

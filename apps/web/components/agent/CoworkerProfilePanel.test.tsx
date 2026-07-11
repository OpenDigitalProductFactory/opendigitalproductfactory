// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentInfo } from "@/lib/agent-coworker-types";

const getProactivityPreference = vi.fn();
const getSelfTaskCadenceInfo = vi.fn();

vi.mock("@/lib/actions/proactivity", () => ({
  getCoworkerProactivityPreference: (agentId: string) => getProactivityPreference(agentId),
  getCoworkerSelfTaskCadenceInfo: (agentId: string) => getSelfTaskCadenceInfo(agentId),
  saveCoworkerProactivityPreference: vi.fn(async () => ({ ok: true })),
}));

import { CoworkerProfilePanel } from "./CoworkerProfilePanel";

afterEach(() => {
  cleanup();
  getProactivityPreference.mockReset();
  getSelfTaskCadenceInfo.mockReset();
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
  it("shows only ENFORCED proactivity effects — no monitoring/approval/escalation promises (BI-AB7CD55B)", async () => {
    getProactivityPreference.mockResolvedValue(null);
    getSelfTaskCadenceInfo.mockResolvedValue({ registered: false, cadence: null });
    render(<CoworkerProfilePanel agent={makeAgent()} onClose={vi.fn()} />);

    // Two "Proactivity" texts are expected since EP-26E528F5: the section
    // header plus the shared editable control's own label.
    expect(screen.getAllByText("Proactivity").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Balanced").length).toBeGreaterThan(0);
    expect(screen.getByText(/Balanced is the default proactivity level/i)).toBeTruthy();
    // The honest effects list: real runtime consumers only.
    expect(screen.getByText("Opening briefing")).toBeTruthy();
    expect(await screen.findByText(/Not available for this coworker yet/i)).toBeTruthy();
    // The old advertised-but-unenforced chips must be gone.
    expect(screen.queryByText(/Monitoring:/i)).toBeNull();
    expect(screen.queryByText(/Approval:/i)).toBeNull();
    expect(screen.queryByText(/Escalates to:/i)).toBeNull();
    expect(screen.queryByText(/proactivity:scheduled-task:balanced/i)).toBeNull();
  });

  it("shows the real self-task cadence for registered coworkers", async () => {
    getProactivityPreference.mockResolvedValue("assertive");
    getSelfTaskCadenceInfo.mockResolvedValue({ registered: true, cadence: { balanced: "weekly", assertive: "daily" } });
    render(<CoworkerProfilePanel agent={makeAgent()} onClose={vi.fn()} />);

    expect(await screen.findByText("Daily")).toBeTruthy();
    expect(screen.getByText("Scheduled self-tasks")).toBeTruthy();
  });

  it("loads the saved coworker proactivity preference for the profile summary", async () => {
    getProactivityPreference.mockResolvedValue("assertive");
    getSelfTaskCadenceInfo.mockResolvedValue({ registered: false, cadence: null });

    render(<CoworkerProfilePanel agent={makeAgent()} onClose={vi.fn()} />);

    expect((await screen.findAllByText("Assertive")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Stay on this/i)).toBeTruthy();
    expect(screen.queryByText(/proactivity:scheduled-task:assertive/i)).toBeNull();
  });
});

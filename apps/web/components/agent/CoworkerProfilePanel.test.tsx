// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentInfo } from "@/lib/agent-coworker-types";

const getProactivityPreference = vi.fn();
const getSelfTaskCadenceInfo = vi.fn();

vi.mock("@/lib/actions/proactivity", () => ({
  getCoworkerSelfTaskCadenceInfo: (agentId: string) => getSelfTaskCadenceInfo(agentId),
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
    getSelfTaskCadenceInfo.mockResolvedValue({ registered: true, cadence: { balanced: "weekly", assertive: "daily" } });
    render(<CoworkerProfilePanel agent={makeAgent()} onClose={vi.fn()} />);

    // BI-87C9C91C: the level is DERIVED (balanced) rather than loaded from a
    // saved per-coworker preference, so the cadence shown is the balanced one.
    expect(await screen.findByText("Weekly")).toBeTruthy();
    expect(screen.getByText("Scheduled self-tasks")).toBeTruthy();
  });

  // BI-87C9C91C — the panel reports the level in force and does not offer to
  // change it on the coworker. Proactivity is owned by the workroom that owns
  // the outcome, so a control here would set a property that no longer exists.
  it("reports the derived level read-only and offers no control", async () => {
    getSelfTaskCadenceInfo.mockResolvedValue({ registered: false, cadence: null });

    render(<CoworkerProfilePanel agent={makeAgent()} onClose={vi.fn()} />);

    expect(await screen.findByText("Set by the room")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    // The removed read path must not be called at all.
    expect(getProactivityPreference).not.toHaveBeenCalled();
  });
});

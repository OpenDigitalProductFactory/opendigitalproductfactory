// @vitest-environment jsdom
import "./test-setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CoworkerPostureInheritance } from "@/lib/actions/golden-triangle";

// The control imports server actions ("use server" → @dpf/db, auth, …). Mock the
// action module so the client component renders in jsdom without server-only deps.
const saveCoworkerGoldenTrianglePosture = vi.fn().mockResolvedValue({ ok: true });
const resetCoworkerGoldenTrianglePosture = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/lib/actions/golden-triangle", () => ({
  saveCoworkerGoldenTrianglePosture: (...a: unknown[]) => saveCoworkerGoldenTrianglePosture(...a),
  resetCoworkerGoldenTrianglePosture: (...a: unknown[]) => resetCoworkerGoldenTrianglePosture(...a),
}));

import { CoworkerPriorityControl } from "./CoworkerPriorityControl";

const PLATFORM_INHERITED: CoworkerPostureInheritance = {
  effective: { preset: "assured", qualityWeight: 0.8, costWeight: 0.1, timeWeight: 0.1 },
  source: "platform",
  hasOwnOverride: false,
};

const OWN_OVERRIDE: CoworkerPostureInheritance = {
  effective: { preset: "frugal", qualityWeight: 0.1, costWeight: 0.8, timeWeight: 0.1 },
  source: "agent",
  hasOwnOverride: true,
};

const COLD_START: CoworkerPostureInheritance = { effective: null, source: null, hasOwnOverride: false };

afterEach(() => {
  saveCoworkerGoldenTrianglePosture.mockClear();
  resetCoworkerGoldenTrianglePosture.mockClear();
});

describe("CoworkerPriorityControl", () => {
  it("shows 'Inherited from Platform default' when the coworker has no own override", () => {
    render(<CoworkerPriorityControl agentId="agent-x" inheritance={PLATFORM_INHERITED} canWrite />);
    expect(screen.getByText("Inherited from Platform default")).toBeInTheDocument();
  });

  it("shows 'Overridden for this coworker' + a reset control when an override is set", () => {
    render(<CoworkerPriorityControl agentId="agent-x" inheritance={OWN_OVERRIDE} canWrite />);
    expect(screen.getByText("Overridden for this coworker")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reset to inherited/ })).toBeInTheDocument();
  });

  it("falls back to the Balanced cold-start line when nothing is set anywhere", () => {
    render(<CoworkerPriorityControl agentId="agent-x" inheritance={COLD_START} canWrite />);
    expect(screen.getByText(/Inherited from Platform default \(Balanced\)/)).toBeInTheDocument();
  });

  it("writes the override (debounced) when a preset is chosen", async () => {
    vi.useFakeTimers();
    try {
      render(<CoworkerPriorityControl agentId="agent-x" inheritance={PLATFORM_INHERITED} canWrite />);
      fireEvent.click(screen.getByRole("radio", { name: /Frugal/ }));
      await vi.advanceTimersByTimeAsync(800);
      expect(saveCoworkerGoldenTrianglePosture).toHaveBeenCalledTimes(1);
      expect(saveCoworkerGoldenTrianglePosture).toHaveBeenCalledWith(
        "agent-x",
        expect.objectContaining({ preset: "frugal" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("calls the reset action when 'Reset to inherited' is clicked", async () => {
    render(<CoworkerPriorityControl agentId="agent-x" inheritance={OWN_OVERRIDE} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /Reset to inherited/ }));
    await waitFor(() => expect(resetCoworkerGoldenTrianglePosture).toHaveBeenCalledWith("agent-x"));
  });

  it("is read-only without manage_platform: no presets, no reset, just the configured chips", () => {
    render(<CoworkerPriorityControl agentId="agent-x" inheritance={OWN_OVERRIDE} canWrite={false} />);
    expect(screen.queryByRole("radio", { name: /Frugal/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reset to inherited/ })).not.toBeInTheDocument();
    expect(screen.getByText(/read-only — requires platform-admin/)).toBeInTheDocument();
  });
});

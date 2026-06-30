// @vitest-environment jsdom
import "./test-setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPosture = vi.fn();
const savePosture = vi.fn();

vi.mock("@/lib/actions/golden-triangle", () => ({
  getCoworkerGoldenTrianglePosture: (agentId: string) => getPosture(agentId),
  saveCoworkerGoldenTrianglePosture: (agentId: string, pref: unknown) => savePosture(agentId, pref),
}));

import { CoworkerPriorityDock } from "./CoworkerPriorityDock";

describe("CoworkerPriorityDock", () => {
  beforeEach(() => {
    getPosture.mockReset();
    savePosture.mockReset();
    savePosture.mockResolvedValue({ ok: true });
  });

  it("is collapsed by default — the resting state is the chip, triangle hidden until opened", async () => {
    getPosture.mockResolvedValueOnce(null);
    render(<CoworkerPriorityDock agentId="agent-1" />);
    await waitFor(() => expect(getPosture).toHaveBeenCalledWith("agent-1"));
    // Resting state: the Priority chip shows; the control (presets) does NOT.
    const header = screen.getByRole("button", { name: /Priority/ });
    expect(header).toBeTruthy();
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /Proactivity balanced/i })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /Assured/ })).toBeNull();
  });

  it("loads this coworker's own posture into the docked header", async () => {
    getPosture.mockResolvedValueOnce({ preset: "frugal", qualityWeight: 0.1, costWeight: 0.8, timeWeight: 0.1 });
    render(<CoworkerPriorityDock agentId="agent-1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Priority.*Frugal/ })).toBeTruthy());
  });

  it("expands on open and re-collapses in place", async () => {
    getPosture.mockResolvedValueOnce(null);
    render(<CoworkerPriorityDock agentId="agent-1" />);
    await waitFor(() => expect(getPosture).toHaveBeenCalled());
    expect(screen.queryByRole("radio", { name: /Assured/ })).toBeNull(); // collapsed by default
    fireEvent.click(screen.getByRole("button", { name: /Priority/ })); // open
    expect(screen.getByRole("radio", { name: /Assured/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Priority/ })); // close
    expect(screen.queryByRole("radio", { name: /Assured/ })).toBeNull();
  });

  it("saves the coworker's posture (debounced) after a change", async () => {
    getPosture.mockResolvedValueOnce(null);
    render(<CoworkerPriorityDock agentId="agent-1" />);
    await waitFor(() => expect(getPosture).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Priority/ })); // open the dock first
    fireEvent.click(screen.getByRole("radio", { name: /Assured/ }));
    await waitFor(() => expect(savePosture).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(savePosture.mock.calls[0][0]).toBe("agent-1");
    expect((savePosture.mock.calls[0][1] as { preset: string }).preset).toBe("assured");
  });
});

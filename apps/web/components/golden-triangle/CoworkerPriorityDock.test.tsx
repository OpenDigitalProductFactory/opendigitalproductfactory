// @vitest-environment jsdom
import "./test-setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPosture = vi.fn();
const savePosture = vi.fn();
const getProactivityPreference = vi.fn();
const saveProactivityPreference = vi.fn();

vi.mock("@/lib/actions/golden-triangle", () => ({
  getCoworkerGoldenTrianglePosture: (agentId: string) => getPosture(agentId),
  saveCoworkerGoldenTrianglePosture: (agentId: string, pref: unknown) => savePosture(agentId, pref),
}));

vi.mock("@/lib/actions/proactivity", () => ({
  getCoworkerProactivityPreference: (agentId: string) => getProactivityPreference(agentId),
  saveCoworkerProactivityPreference: (agentId: string, level: unknown) => saveProactivityPreference(agentId, level),
}));

import { CoworkerPriorityDock } from "./CoworkerPriorityDock";
import { SHELL_TAP_TARGET_CLASS } from "@/lib/shell/shell-action-contract";

describe("CoworkerPriorityDock", () => {
  beforeEach(() => {
    getPosture.mockReset();
    savePosture.mockReset();
    getProactivityPreference.mockReset();
    saveProactivityPreference.mockReset();
    savePosture.mockResolvedValue({ ok: true });
    getProactivityPreference.mockResolvedValue(null);
    saveProactivityPreference.mockResolvedValue({ ok: true });
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

  it("loads and saves this coworker's proactivity level next to priority", async () => {
    getPosture.mockResolvedValueOnce(null);
    getProactivityPreference.mockResolvedValueOnce("assertive");

    render(<CoworkerPriorityDock agentId="agent-1" />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Proactivity assertive/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Proactivity assertive/i }));
    fireEvent.click(screen.getByRole("button", { name: /Quiet/i }));

    await waitFor(() => expect(saveProactivityPreference).toHaveBeenCalledWith("agent-1", "quiet"));
    expect(screen.getByRole("button", { name: /Proactivity quiet/i })).toBeTruthy();
  });

  // BI-20716EA4 — a swallowed `.catch(() => {})` used to leave the owner with
  // no signal that a posture/proactivity change never persisted.
  it("surfaces a failed proactivity save with a plain-language retry (BI-20716EA4)", async () => {
    getPosture.mockResolvedValueOnce(null);
    getProactivityPreference.mockResolvedValueOnce("assertive");
    saveProactivityPreference.mockResolvedValueOnce({ ok: false, error: "Network error" });

    render(<CoworkerPriorityDock agentId="agent-1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Proactivity assertive/i })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Proactivity assertive/i }));
    fireEvent.click(screen.getByRole("button", { name: /Quiet/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Network error");
    // Optimistic value snaps back to the last confirmed level.
    expect(screen.getByRole("button", { name: /Proactivity assertive/i })).toBeTruthy();

    const retryButton = screen.getByRole("button", { name: "Retry" });
    expect(retryButton).toHaveClass(SHELL_TAP_TARGET_CLASS);
    expect(screen.getByRole("button", { name: "Revert" })).toHaveClass(SHELL_TAP_TARGET_CLASS);

    saveProactivityPreference.mockResolvedValueOnce({ ok: true });
    fireEvent.click(retryButton);
    await screen.findByText("Proactivity saved");
  });

  it("surfaces a failed posture save (debounced) and reverts on failure (BI-20716EA4)", async () => {
    getPosture.mockResolvedValueOnce(null);
    savePosture.mockResolvedValueOnce({ ok: false });

    render(<CoworkerPriorityDock agentId="agent-1" />);
    await waitFor(() => expect(getPosture).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Priority/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Assured/ }));

    await waitFor(() => expect(savePosture).toHaveBeenCalledTimes(1), { timeout: 2000 });
    await screen.findByRole("alert");
    // Snapped back to the pre-edit label (Balanced default).
    expect(screen.getByRole("button", { name: /Priority.*Balanced/ })).toBeTruthy();
  });

  it("resets a subject's save state when the dock is reused for a different coworker", async () => {
    getPosture.mockResolvedValueOnce(null);
    saveProactivityPreference.mockResolvedValueOnce({ ok: false });
    getProactivityPreference.mockResolvedValueOnce("assertive");

    const { rerender } = render(<CoworkerPriorityDock agentId="agent-1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Proactivity assertive/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Proactivity assertive/i }));
    fireEvent.click(screen.getByRole("button", { name: /Quiet/i }));
    await screen.findByRole("alert");

    getPosture.mockResolvedValueOnce(null);
    getProactivityPreference.mockResolvedValueOnce("balanced");
    rerender(<CoworkerPriorityDock agentId="agent-2" />);

    // The failed status from agent-1 must not leak onto agent-2's dock.
    await waitFor(() => expect(screen.getByRole("button", { name: /Proactivity balanced/i })).toBeTruthy());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

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
import { SHELL_TAP_TARGET_CLASS } from "@/lib/shell/shell-action-contract";

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

  // BI-87C9C91C — proactivity is owned by the outcome-specific Workroom, so the
  // dock no longer exposes a per-coworker proactivity control. Asserted as an
  // ABSENCE because the defect being prevented is a control that reappears and
  // writes a preference nothing reads.
  it("exposes no per-coworker proactivity control", async () => {
    getPosture.mockResolvedValueOnce(null);

    render(<CoworkerPriorityDock agentId="agent-1" />);
    await waitFor(() => expect(getPosture).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: /Proactivity/i })).toBeNull();
    expect(screen.queryByText(/Proactivity/i)).toBeNull();
    // Priority is a different axis and must survive.
    expect(screen.getByRole("button", { name: /Priority/ })).toBeTruthy();
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
    savePosture.mockResolvedValueOnce({ ok: false });

    const { rerender } = render(<CoworkerPriorityDock agentId="agent-1" />);
    await waitFor(() => expect(getPosture).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Priority/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Assured/ }));
    await waitFor(() => expect(savePosture).toHaveBeenCalledTimes(1), { timeout: 2000 });
    await screen.findByRole("alert");

    getPosture.mockResolvedValueOnce(null);
    rerender(<CoworkerPriorityDock agentId="agent-2" />);

    // The failed status from agent-1 must not leak onto agent-2's dock.
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

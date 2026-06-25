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

import { CoworkerPriorityControl } from "./CoworkerPriorityControl";

describe("CoworkerPriorityControl (per-coworker)", () => {
  beforeEach(() => {
    getPosture.mockReset();
    savePosture.mockReset();
    savePosture.mockResolvedValue({ ok: true });
  });

  it("loads this coworker's own saved posture", async () => {
    getPosture.mockResolvedValueOnce({ preset: "frugal", qualityWeight: 0.1, costWeight: 0.8, timeWeight: 0.1 });
    render(<CoworkerPriorityControl agentId="agent-1" />);
    await waitFor(() => expect(getPosture).toHaveBeenCalledWith("agent-1"));
    await waitFor(() => expect(screen.getByText(/Priority: Frugal/)).toBeTruthy());
  });

  it("falls back to Balanced when the coworker has no posture", async () => {
    getPosture.mockResolvedValueOnce(null);
    render(<CoworkerPriorityControl agentId="agent-1" />);
    await waitFor(() => expect(getPosture).toHaveBeenCalled());
    expect(screen.getByText(/Priority: Balanced/)).toBeTruthy();
  });

  it("saves the coworker's own posture on Done after a change", async () => {
    getPosture.mockResolvedValueOnce(null);
    render(<CoworkerPriorityControl agentId="agent-1" />);
    await waitFor(() => expect(getPosture).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Priority:/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Assured/ }));
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() => expect(savePosture).toHaveBeenCalledTimes(1));
    expect(savePosture.mock.calls[0][0]).toBe("agent-1");
    expect((savePosture.mock.calls[0][1] as { preset: string }).preset).toBe("assured");
  });

  it("does not save on Done when nothing changed", async () => {
    getPosture.mockResolvedValueOnce(null);
    render(<CoworkerPriorityControl agentId="agent-1" />);
    await waitFor(() => expect(getPosture).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Priority:/ }));
    fireEvent.click(screen.getByText("Done"));
    expect(savePosture).not.toHaveBeenCalled();
  });

  it("auto-collapses on click-away", async () => {
    getPosture.mockResolvedValueOnce(null);
    render(<CoworkerPriorityControl agentId="agent-1" />);
    await waitFor(() => expect(getPosture).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Priority:/ }));
    expect(screen.getByText("Done")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByText("Done")).toBeNull());
  });
});

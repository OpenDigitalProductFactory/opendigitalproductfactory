// @vitest-environment jsdom
import "./test-setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDefault = vi.fn();
const saveDefault = vi.fn();

vi.mock("@/lib/actions/golden-triangle", () => ({
  getGoldenTrianglePlatformDefault: () => getDefault(),
  saveGoldenTrianglePlatformDefault: (p: unknown) => saveDefault(p),
}));

import { CoworkerPriorityControl } from "./CoworkerPriorityControl";

describe("CoworkerPriorityControl", () => {
  beforeEach(() => {
    getDefault.mockReset();
    saveDefault.mockReset();
  });

  it("reflects the saved platform default once it loads", async () => {
    getDefault.mockResolvedValueOnce({ preset: "frugal", qualityWeight: 0.1, costWeight: 0.8, timeWeight: 0.1 });
    render(<CoworkerPriorityControl />);
    await waitFor(() => expect(screen.getByText(/Priority: Frugal/)).toBeTruthy());
  });

  it("falls back to Balanced when nothing is saved", async () => {
    getDefault.mockResolvedValueOnce(null);
    render(<CoworkerPriorityControl />);
    await waitFor(() => expect(getDefault).toHaveBeenCalled());
    expect(screen.getByText(/Priority: Balanced/)).toBeTruthy();
  });

  it("saves the posture as the platform default and confirms", async () => {
    getDefault.mockResolvedValueOnce(null);
    saveDefault.mockResolvedValueOnce({ ok: true });
    render(<CoworkerPriorityControl />);
    await waitFor(() => expect(getDefault).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Priority:/ }));
    fireEvent.click(screen.getByText("Save as default"));
    await waitFor(() => expect(saveDefault).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
  });

  it("shows a failure note when the save is rejected (e.g. non-admin)", async () => {
    getDefault.mockResolvedValueOnce(null);
    saveDefault.mockRejectedValueOnce(new Error("Unauthorized"));
    render(<CoworkerPriorityControl />);
    await waitFor(() => expect(getDefault).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Priority:/ }));
    fireEvent.click(screen.getByText("Save as default"));
    await waitFor(() => expect(screen.getByText(/Couldn’t save/)).toBeTruthy());
  });
});

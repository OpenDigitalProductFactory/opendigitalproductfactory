// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { saveCooConversationalName } = vi.hoisted(() => ({ saveCooConversationalName: vi.fn() }));
vi.mock("@/lib/actions/coo-conversational-name", () => ({ saveCooConversationalName }));

import { CooNameSetupCard } from "./CooNameSetupCard";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("CooNameSetupCard", () => {
  it("explains the boundary and saves a suggested conversational name", async () => {
    saveCooConversationalName.mockResolvedValue({ ok: true, value: "Number Two" });
    const details: unknown[] = [];
    const handler = (event: Event) => details.push((event as CustomEvent).detail);
    document.addEventListener("setup-action", handler);
    render(<CooNameSetupCard progressId="progress-1" initialName={null} />);

    expect(screen.getByText(/does not change the coworker's role, permissions, authority/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Number Two" }));
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

    await waitFor(() => expect(saveCooConversationalName).toHaveBeenCalledWith({ name: "Number Two", setupProgressId: "progress-1" }));
    expect(details).toEqual([{ action: "continue", contextUpdate: { cooConversationalName: "Number Two" } }]);
    document.removeEventListener("setup-action", handler);
  });

  it("can keep the canonical COO title", async () => {
    saveCooConversationalName.mockResolvedValue({ ok: true, value: null });
    render(<CooNameSetupCard progressId="progress-1" initialName="General" />);
    fireEvent.click(screen.getByRole("button", { name: "Keep COO" }));
    await waitFor(() => expect(saveCooConversationalName).toHaveBeenCalledWith({ name: null, setupProgressId: "progress-1" }));
  });

  it("shows validation errors without advancing", async () => {
    saveCooConversationalName.mockResolvedValue({ ok: false, error: "That name is reserved." });
    render(<CooNameSetupCard progressId="progress-1" initialName={null} />);
    fireEvent.change(screen.getByLabelText("Conversational name"), { target: { value: "Owner" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That name is reserved.");
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { saveCooConversationalName } = vi.hoisted(() => ({ saveCooConversationalName: vi.fn() }));
vi.mock("@/lib/actions/coo-conversational-name", () => ({ saveCooConversationalName }));

import { CooConversationalNameCard } from "./CooConversationalNameCard";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("CooConversationalNameCard", () => {
  it("shows a read-only role-preserving presentation to users without write authority", () => {
    render(<CooConversationalNameCard initialName="Navigator" canWrite={false} />);
    expect(screen.getByText(/Presented as Navigator · AI COO/)).toBeVisible();
    expect(screen.getByText(/does not change the canonical COO identity, permissions, authority/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("lets an authorized operator change and clear the preference", async () => {
    saveCooConversationalName
      .mockResolvedValueOnce({ ok: true, value: "General" })
      .mockResolvedValueOnce({ ok: true, value: null });
    render(<CooConversationalNameCard initialName={null} canWrite />);

    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveCooConversationalName).toHaveBeenCalledWith({ name: "General" }));
    expect(await screen.findByText(/Presented as General · AI COO/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Use COO" }));
    await waitFor(() => expect(saveCooConversationalName).toHaveBeenLastCalledWith({ name: null }));
    expect(await screen.findByText(/Presented as COO\./)).toBeVisible();
  });
});

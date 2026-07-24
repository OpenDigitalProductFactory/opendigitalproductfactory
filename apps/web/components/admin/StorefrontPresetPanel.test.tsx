// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorefrontPresetPanel } from "./StorefrontPresetPanel";

const { applyMock, confirmMock, refreshMock } = vi.hoisted(() => ({
  applyMock: vi.fn(),
  confirmMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/actions/dpf-production-instance", () => ({
  applyDpfProductionInstancePreset: applyMock,
}));
vi.mock("@/components/ui/Dialog", () => ({ confirmDialog: confirmMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

describe("StorefrontPresetPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // BI-6F9D487C: this is a destructive, internal support action (overwrites
  // organization/business identity). Moving it off the owner-facing page is
  // only half the fix — it must also require an explicit confirmation before
  // it runs, not fire on a single unconfirmed click.
  it("requires confirmation before applying the preset", async () => {
    confirmMock.mockResolvedValue(true);
    applyMock.mockResolvedValue({});

    render(<StorefrontPresetPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Apply DPF preset" }));

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(confirmMock.mock.calls[0][0]).toMatchObject({ tone: "danger" });

    await waitFor(() => expect(applyMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("does not apply the preset when the confirmation is cancelled", async () => {
    confirmMock.mockResolvedValue(false);

    render(<StorefrontPresetPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Apply DPF preset" }));

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(applyMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

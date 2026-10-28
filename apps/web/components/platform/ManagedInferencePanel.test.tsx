// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ confirm: vi.fn(), request: vi.fn(), refresh: vi.fn() }));
vi.mock("@/components/ui/Dialog", () => ({ confirmDialog: mocks.confirm }));
vi.mock("@/lib/actions/managed-inference", () => ({ requestManagedInferenceTransition: mocks.request }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { ManagedInferencePanel } from "./ManagedInferencePanel";
const offer = { available: true as const, token: "a".repeat(64), operation: "activate" as const,
  impact: "Switch this ready host and allow only its managed engine procedure.", needsNodeGrant: true };
beforeEach(() => { vi.clearAllMocks(); mocks.confirm.mockResolvedValue(true); mocks.request.mockResolvedValue({ ok: true, data: { actionKey: "RA-ready", rfcId: "RFC-ready" } }); });
afterEach(cleanup);
it("does not send a host request when the operator keeps the current engine", async () => {
  mocks.confirm.mockResolvedValue(false); render(<ManagedInferencePanel offer={offer} />);
  fireEvent.click(screen.getByRole("button", { name: "Use tested engine" }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
  expect(mocks.request).not.toHaveBeenCalled();
});
it("confirms the concrete ready change before queueing and labels the result as queued", async () => {
  render(<ManagedInferencePanel offer={offer} />); fireEvent.click(screen.getByRole("button", { name: "Use tested engine" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith({ operation: "activate", offerToken: offer.token, operatorConfirmed: true, allowNodeAction: true }));
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: offer.impact }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Queued"));
  expect(screen.getByRole("status").textContent).not.toContain("activated");
});
it("shows an unavailable window without offering an executable engine change", () => {
  render(<ManagedInferencePanel offer={{ available: false, message: "Waiting for the reserved processing window." }} />);
  expect(screen.queryByRole("button", { name: "Use tested engine" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  expect(mocks.refresh).toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
});

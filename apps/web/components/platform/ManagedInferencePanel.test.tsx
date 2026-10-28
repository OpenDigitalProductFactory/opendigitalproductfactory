// @vitest-environment jsdom
import React from "react";
import { SOURCE_CATALOG } from "@dpf/i18n";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ confirm: vi.fn(), request: vi.fn(), refresh: vi.fn() }));
vi.mock("@/components/ui/Dialog", () => ({ confirmDialog: mocks.confirm }));
vi.mock("@/lib/actions/managed-inference", () => ({ requestManagedInferenceTransition: mocks.request }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { ManagedInferencePanel } from "./ManagedInferencePanel";
const offer = { available: true as const, token: "a".repeat(64), operation: "activate" as const,
  impact: "Switch this ready host and allow only its managed engine procedure.", needsNodeGrant: true };
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.confirm.mockResolvedValue(true); mocks.request.mockResolvedValue({ ok: true, data: { actionKey: "RA-ready", rfcId: "RFC-ready" } }); });
afterEach(cleanup);
it("does not send a host request when the operator keeps the current engine", async () => {
  mocks.confirm.mockResolvedValue(false); render(<ManagedInferencePanel copy={SOURCE_CATALOG.providerAccounts} offer={offer} />);
  fireEvent.click(screen.getByRole("button", { name: "Use tested engine" }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
  expect(mocks.request).not.toHaveBeenCalled();
});
it("confirms the concrete ready change before queueing and labels the result as queued", async () => {
  render(<ManagedInferencePanel copy={SOURCE_CATALOG.providerAccounts} offer={offer} />); fireEvent.click(screen.getByRole("button", { name: "Use tested engine" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith({ requestId: expect.stringMatching(/^[a-f0-9]{32}$/), operation: "activate", offerToken: offer.token, operatorConfirmed: true, allowNodeAction: true }));
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: offer.impact }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("queued"));
  expect(screen.getByRole("status").textContent).not.toContain("activated");
});
it("retains the original request across a lost response and reload instead of enabling another switch", async () => {
  mocks.request.mockRejectedValue(new Error("response lost"));
  const first = render(<ManagedInferencePanel copy={SOURCE_CATALOG.providerAccounts} offer={offer} />);
  fireEvent.click(screen.getByRole("button", { name: "Use tested engine" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
  const id = mocks.request.mock.calls[0][0].requestId;
  await waitFor(() => expect(screen.getByRole("button", { name: "Check original request" })).toBeTruthy());
  expect(screen.queryByRole("button", { name: "Use tested engine" })).toBeNull();
  first.unmount(); render(<ManagedInferencePanel copy={SOURCE_CATALOG.providerAccounts} offer={offer} />);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Use tested engine" })).toBeNull());
  expect(localStorage.getItem("dpf:managed-inference:pending")).toBe(id);
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("shows an unavailable window without offering an executable engine change", () => {
  render(<ManagedInferencePanel copy={SOURCE_CATALOG.providerAccounts} offer={{ available: false, message: "Waiting for the reserved processing window." }} />);
  expect(screen.queryByRole("button", { name: "Use tested engine" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  expect(mocks.refresh).toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
});

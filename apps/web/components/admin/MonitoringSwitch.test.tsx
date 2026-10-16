// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/runtime-capabilities", () => ({
  requestMonitoringChange: (...args: unknown[]) => requestMock(...args),
}));

import { namespaceMessages } from "@dpf/i18n";
import type { ComponentProps } from "react";

import { MonitoringSwitch as Switch, newMonitoringTransitionId } from "@/components/admin/MonitoringSwitch";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";

afterEach(() => {
  cleanup();
  requestMock.mockReset();
});

function MonitoringSwitch(props: ComponentProps<typeof Switch>) {
  return (
    <MessagesProvider locale="en-US" messages={{ admin: namespaceMessages("en-US", "admin") }}>
      <Switch {...props} />
    </MessagesProvider>
  );
}

describe("MonitoringSwitch", () => {
  it("mints transition ids the server action accepts", () => {
    const id = newMonitoringTransitionId();
    expect(id).toMatch(/^RCT-[A-Za-z0-9-]{1,48}$/);
    expect(newMonitoringTransitionId()).not.toBe(id);
  });

  it("turns monitoring on and shows the plain outcome", async () => {
    requestMock.mockResolvedValue({ status: "succeeded" });
    render(<MonitoringSwitch enabled={false} canToggle reasonKey={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn monitoring on" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Done. Monitoring has been changed."));
    // BI-F0C2E8F5: the switch asks for a reconciliation-mode change, never a raw key set.
    expect(requestMock).toHaveBeenCalledWith({ transitionId: expect.stringMatching(/^RCT-/), turnOn: true });
  });

  it("offers to match the record to what is running when only the record disagrees", async () => {
    requestMock.mockResolvedValue({ status: "succeeded" });
    render(<MonitoringSwitch enabled={false} recordMismatch canToggle reasonKey={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Match records: monitoring is off" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(requestMock).toHaveBeenCalledWith({ transitionId: expect.stringMatching(/^RCT-/), turnOn: false });
  });

  it("shows plain copy for a returned reconciliation failure", async () => {
    requestMock.mockResolvedValue({ status: "failed", failure: "runtime_reconciliation_host_stale" });
    render(<MonitoringSwitch enabled={false} canToggle reasonKey={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn monitoring on" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("The install changed while this page was open"));
  });

  it("names the failure and the transition id", async () => {
    requestMock.mockResolvedValue({ status: "failed", failure: "promoter_unavailable" });
    render(<MonitoringSwitch enabled canToggle reasonKey={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn monitoring off" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/promoter_unavailable \(change RCT-/));
  });

  it("maps a thrown admission refusal", async () => {
    requestMock.mockRejectedValue(new Error("runtime_capability_reconciliation_in_progress"));
    render(<MonitoringSwitch enabled={false} canToggle reasonKey={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn monitoring on" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Another change is already in progress"));
  });

  it("is disabled with its reason when it cannot toggle", () => {
    render(<MonitoringSwitch enabled={false} canToggle={false} reasonKey="monitoringSettings.reason.unreconciled" />);
    const button = screen.getByRole("button", { name: "Turn monitoring on" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Capability records need repair first")).toBeTruthy();
    fireEvent.click(button);
    expect(requestMock).not.toHaveBeenCalled();
  });
});

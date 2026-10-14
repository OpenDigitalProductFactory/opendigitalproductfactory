// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/runtime-capabilities", () => ({
  requestRuntimeCapabilityTransition: (...args: unknown[]) => requestMock(...args),
}));

import { namespaceMessages } from "@dpf/i18n";
import type { ComponentProps } from "react";

import {
  MonitoringSwitch as Switch,
  desiredMonitoringKeys,
  newMonitoringTransitionId,
} from "@/components/admin/MonitoringSwitch";
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

  it("adds or removes only the monitoring capability", () => {
    expect(desiredMonitoringKeys(["runtime:core"], true)).toEqual(["runtime:core", "runtime:deep-observability"]);
    expect(desiredMonitoringKeys(["runtime:core", "runtime:deep-observability", "runtime:build"], false)).toEqual(["runtime:core", "runtime:build"]);
  });

  it("turns monitoring on and shows the plain outcome", async () => {
    requestMock.mockResolvedValue({ status: "succeeded" });
    render(<MonitoringSwitch enabled={false} enabledKeys={["runtime:core"]} canToggle reasonKey={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn monitoring on" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Done. Monitoring has been changed."));
    expect(requestMock).toHaveBeenCalledWith({
      transitionId: expect.stringMatching(/^RCT-/),
      desiredKeys: ["runtime:core", "runtime:deep-observability"],
    });
  });

  it("names the failure and the transition id", async () => {
    requestMock.mockResolvedValue({ status: "failed", failure: "promoter_unavailable" });
    render(<MonitoringSwitch enabled enabledKeys={["runtime:core", "runtime:deep-observability"]} canToggle reasonKey={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn monitoring off" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/promoter_unavailable \(change RCT-/));
  });

  it("maps a thrown admission refusal", async () => {
    requestMock.mockRejectedValue(new Error("runtime_capability_reconciliation_in_progress"));
    render(<MonitoringSwitch enabled={false} enabledKeys={["runtime:core"]} canToggle reasonKey={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn monitoring on" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Another change is already in progress"));
  });

  it("is disabled with its reason when it cannot toggle", () => {
    render(<MonitoringSwitch enabled={false} enabledKeys={["runtime:core"]} canToggle={false} reasonKey="monitoringSettings.reason.unreconciled" />);
    const button = screen.getByRole("button", { name: "Turn monitoring on" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Capability state needs reconciling first")).toBeTruthy();
    fireEvent.click(button);
    expect(requestMock).not.toHaveBeenCalled();
  });
});

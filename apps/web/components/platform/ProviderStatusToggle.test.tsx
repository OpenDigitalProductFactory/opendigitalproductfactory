// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as renderView, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
const actions = vi.hoisted(() => ({ getProviderPause: vi.fn(), pauseProvider: vi.fn(), resumeProvider: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/actions/provider-operator-pause", () => actions);
vi.mock("@/lib/actions/ai-providers", () => ({ toggleProviderStatus: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: actions.refresh }) }));
import { ProviderStatusToggle } from "./ProviderStatusToggle";
function render(node: ReactNode) {
  return renderView(node, { wrapper: ({ children }) => <MessagesProvider locale="en-US" messages={{ setup: namespaceMessages("en-US", "setup") }}>{children}</MessagesProvider> });
}

describe("local provider pause control", () => {
  beforeEach(() => {
    cleanup();
    vi.resetAllMocks();
    actions.getProviderPause.mockResolvedValue(null);
    actions.pauseProvider.mockResolvedValue({ resumeAt: null, warning: null });
    actions.resumeProvider.mockResolvedValue({ outcome: "resumed", status: "active" });
  });
  it("pauses immediately before asking for an optional duration", async () => {
    render(<ProviderStatusToggle providerId="local" initialStatus="active" />);
    fireEvent.click(screen.getByRole("button", { name: "Pause now" }));
    await waitFor(() => expect(actions.pauseProvider).toHaveBeenCalledWith("local"));
    expect(await screen.findByRole("button", { name: "Resume now" })).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });
  it("adds a duration only to an already paused provider", async () => {
    actions.getProviderPause.mockResolvedValue({ resumeAt: null });
    render(<ProviderStatusToggle providerId="local" initialStatus="inactive" />);
    fireEvent.click(await screen.findByRole("button", { name: "Set resume time" }));
    fireEvent.change(screen.getByLabelText("Pause duration"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Duration unit"), { target: { value: "days" } });
    fireEvent.click(screen.getByRole("button", { name: "Save resume time" }));
    await waitFor(() => expect(actions.pauseProvider).toHaveBeenCalledWith("local", { value: 2, unit: "days" }));
  });
  it("shows a persisted resume time and supports early resume", async () => {
    actions.getProviderPause.mockResolvedValue({ resumeAt: "2026-10-14T02:00:00.000Z" });
    render(<ProviderStatusToggle providerId="local" initialStatus="inactive" />);
    fireEvent.click(await screen.findByRole("button", { name: "Resume now" }));
    await waitFor(() => expect(actions.resumeProvider).toHaveBeenCalledWith("local"));
    expect(await screen.findByRole("button", { name: "Pause now" })).toBeTruthy();
  });
  it("renders server pause data immediately and updates it after a refresh", async () => {
    const view = render(<ProviderStatusToggle providerId="local" initialStatus="inactive" initialConnectionStatus="paused" initialPause={{ resumeAt: "2026-10-14T02:00:00Z" }} />);
    expect(screen.getByText("Paused")).toBeTruthy();
    expect(actions.getProviderPause).not.toHaveBeenCalled();
    view.rerender(<ProviderStatusToggle providerId="local" initialStatus="active" initialConnectionStatus="active" initialPause={null} />);
    expect(await screen.findByRole("button", { name: "Pause now" })).toBeTruthy();
    expect(screen.queryByText("Paused")).toBeNull();
  });
  it("distinguishes a health restriction from an operator disable", () => {
    render(<ProviderStatusToggle providerId="local" initialStatus="inactive" initialConnectionStatus="active" initialPause={null} />);
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.queryByText("Until you resume it")).toBeNull();
    expect(screen.queryByRole("button", { name: "Resume now" })).toBeNull();
  });
});

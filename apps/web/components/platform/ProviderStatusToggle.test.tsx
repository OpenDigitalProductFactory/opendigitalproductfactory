// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as renderView, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import type { FormatInstantOptions } from "@/lib/datetime";
const actions = vi.hoisted(() => ({ getProviderPause: vi.fn(), pauseProvider: vi.fn(), resumeProvider: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/actions/provider-operator-pause", () => actions);
vi.mock("@/lib/actions/ai-providers", () => ({ toggleProviderStatus: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: actions.refresh }) }));
// Supply a fixed browser timezone while retaining the real formatter and the
// explicit UTC requested by the shared component's first render.
vi.mock("@/lib/datetime", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/datetime")>();
  return { ...actual, formatInstant: (value: string | number | Date, options: FormatInstantOptions = {}) => actual.formatInstant(value, { ...options, timeZone: options.timeZone ?? "America/Chicago" }) };
});
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
  it("can reuse the page routing badge without repeating status in its controls", () => {
    render(<ProviderStatusToggle providerId="local" initialStatus="inactive" initialConnectionStatus="paused" initialPause={{ resumeAt: null }} hideStatus />);
    expect(screen.queryByText("Paused")).toBeNull();
    expect(screen.getByRole("button", { name: "Resume now" })).toBeTruthy();
  });
  it("pauses immediately before asking for an optional duration", async () => {
    render(<ProviderStatusToggle providerId="local" initialStatus="active" />);
    fireEvent.click(screen.getByRole("button", { name: "Pause now" }));
    await waitFor(() => expect(actions.pauseProvider).toHaveBeenCalledWith("local"));
    expect(await screen.findByRole("button", { name: "Resume now" })).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });
  it("uses the same timed control for a cloud provider without reactivating automatic disable", async () => {
    actions.resumeProvider.mockResolvedValue({ outcome: "resumed", status: "disabled", connectionStatus: "active" });
    render(<ProviderStatusToggle providerId="chatgpt" initialStatus="disabled" initialConnectionStatus="paused" initialPause={{ resumeAt: "2026-10-14T02:00:00Z" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume now" }));
    await waitFor(() => expect(actions.resumeProvider).toHaveBeenCalledWith("chatgpt"));
    expect(await screen.findByText("Unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resume now" })).toBeNull();
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
  it("uses a deterministic UTC first render before browser localization", () => {
    const html = renderToString(<MessagesProvider locale="en-US" messages={{ setup: namespaceMessages("en-US", "setup") }}><ProviderStatusToggle providerId="local" initialStatus="inactive" initialConnectionStatus="paused" initialPause={{ resumeAt: "2026-10-14T02:00:00Z" }} /></MessagesProvider>);
    expect(html).toContain("UTC");
    expect(html).toContain("Oct 14");
    expect(html).not.toContain("CDT");
    render(<ProviderStatusToggle providerId="local" initialStatus="inactive" initialConnectionStatus="paused" initialPause={{ resumeAt: "2026-10-14T02:00:00Z" }} />);
    expect(screen.getByText(/CDT/)).toBeTruthy();
    expect(screen.getByText(/Oct 13/)).toBeTruthy();
  });
});

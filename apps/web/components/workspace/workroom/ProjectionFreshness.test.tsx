// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render as renderComponent, screen } from "@testing-library/react";
import { useState, type ReactElement, type ReactNode } from "react";
import { DEFAULT_LOCALE, namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { ProjectionFreshness } from "./ProjectionFreshness";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
const render = (ui: ReactElement) => renderComponent(ui, {
  wrapper: ({ children }: { children: ReactNode }) => <MessagesProvider locale={DEFAULT_LOCALE}
    messages={{ workrooms: namespaceMessages(DEFAULT_LOCALE, "workrooms") }}>{children}</MessagesProvider>,
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); vi.restoreAllMocks(); });

describe("projection freshness", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-21T12:00:00Z")); });
  it.each([null, "invalid", "2026-09-22T12:00:00Z"])("does not assert freshness for %s", readAt => {
    render(<ProjectionFreshness onRefresh={refresh} readAt={readAt} lastEvidenceAt={null} />);
    expect(screen.getByText("Snapshot age unknown.")).toBeInTheDocument();
  });
  it("checks the current clock when a newer server snapshot arrives", () => {
    const { rerender } = render(<ProjectionFreshness readAt="2026-09-21T11:00:00Z" lastEvidenceAt={null} />);
    act(() => vi.setSystemTime(new Date("2026-09-21T12:05:00Z")));
    rerender(<ProjectionFreshness readAt="2026-09-21T12:05:00Z" lastEvidenceAt={null} />);
    expect(screen.getByText("Recent snapshot.")).toBeInTheDocument();
  });
  it("rechecks elapsed time after a suspended tab returns", () => {
    render(<ProjectionFreshness readAt="2026-09-21T12:00:00Z" lastEvidenceAt={null} />);
    act(() => vi.setSystemTime(new Date("2026-09-21T12:05:00Z")));
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByText(/Snapshot stale/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

function ControlledRefresh() {
  const [pending, setPending] = useState(false);
  return <ProjectionFreshness readAt={null} lastEvidenceAt={null} pending={pending} onRefresh={() => {
    setPending(true); Promise.resolve(refresh()).finally(() => setPending(false));
  }} />;
}

function deferredRefresh() {
  let complete!: () => void;
  refresh.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
  return () => complete();
}

describe("Workroom snapshot connectivity", () => {
  it("preserves the two existing freshness paragraphs when there is no connectivity notice", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { container } = render(<ProjectionFreshness onRefresh={refresh} readAt={null} lastEvidenceAt={null} />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it("retains the snapshot and keyboard target when offline, then offers manual retry without refreshing automatically", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<ProjectionFreshness onRefresh={refresh} readAt="2026-10-16T03:00:00Z" lastEvidenceAt={null} />);
    const button = screen.getByRole("button", { name: "Refresh state" });
    button.focus();
    await act(async () => { fireEvent.click(button); });
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText("Browser offline. Showing the saved snapshot. Reconnect to refresh.").closest("p")).toHaveAttribute("aria-live", "polite");
    expect(button).toHaveFocus();
    expect(button).not.toBeDisabled();
    online.mockReturnValue(true);
    fireEvent(window, new Event("online"));
    expect(screen.getByText("Connection restored. Refresh to check for changes.").closest("p")).toHaveAttribute("aria-live", "polite");
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(button); });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("checks connectivity at activation even if the offline event has not arrived", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<ProjectionFreshness onRefresh={refresh} readAt={null} lastEvidenceAt={null} />);
    online.mockReturnValue(false);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh state" })); });
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText(/Browser offline/)).toBeInTheDocument();
  });

  it("announces an offline event without replacing the snapshot or refreshing", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<ProjectionFreshness onRefresh={refresh} readAt={null} lastEvidenceAt={null} />);
    fireEvent(window, new Event("offline"));
    expect(screen.getByText(/Browser offline/)).toBeInTheDocument();
    expect(screen.getByText("Snapshot age unknown.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("Workroom snapshot refresh focus", () => {
  it("keeps its keyboard target focusable while pending, guards repeat activation and retains focus on completion", async () => {
    const complete = deferredRefresh();
    render(<ControlledRefresh />);
    const button = screen.getByRole("button", { name: "Refresh state" });
    button.focus();
    await act(async () => { fireEvent.click(button); });
    const pending = screen.getByRole("button", { name: "Refreshing state…" });
    // A native disabled button drops real browser keyboard focus (live AC09).
    expect(pending).not.toBeDisabled();
    expect(pending).toHaveAttribute("aria-disabled", "true");
    expect(pending).toHaveFocus();
    fireEvent.click(pending);
    expect(refresh).toHaveBeenCalledOnce();
    await act(async () => complete());
    expect(screen.getByRole("button", { name: "Refresh state" })).toHaveFocus();
    expect(button).toHaveAttribute("aria-disabled", "false");
  });

  it("does not steal focus if the operator moves to another action while the refresh is pending", async () => {
    const complete = deferredRefresh();
    render(<><ControlledRefresh /><button>Next action</button></>);
    const refreshButton = screen.getByRole("button", { name: "Refresh state" });
    refreshButton.focus();
    await act(async () => { fireEvent.click(refreshButton); });
    const next = screen.getByRole("button", { name: "Next action" });
    next.focus();
    await act(async () => complete());
    expect(next).toHaveFocus();
  });
});

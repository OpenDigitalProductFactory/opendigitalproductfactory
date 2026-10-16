// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProjectionFreshness } from "./ProjectionFreshness";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("projection freshness", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-21T12:00:00Z")); });
  it.each([null, "invalid", "2026-09-22T12:00:00Z"])("does not assert freshness for %s", readAt => {
    render(<ProjectionFreshness readAt={readAt} lastEvidenceAt={null} />);
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

function deferredRefresh() {
  let complete!: () => void;
  refresh.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
  return () => complete();
}

describe("Workroom snapshot refresh focus", () => {
  it("keeps its keyboard target focusable while pending, guards repeat activation and retains focus on completion", async () => {
    const complete = deferredRefresh();
    render(<ProjectionFreshness readAt="2026-10-16T03:00:00Z" lastEvidenceAt={null} />);
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
    render(<><ProjectionFreshness readAt={null} lastEvidenceAt={null} /><button>Next action</button></>);
    const refreshButton = screen.getByRole("button", { name: "Refresh state" });
    refreshButton.focus();
    await act(async () => { fireEvent.click(refreshButton); });
    const next = screen.getByRole("button", { name: "Next action" });
    next.focus();
    await act(async () => complete());
    expect(next).toHaveFocus();
  });
});

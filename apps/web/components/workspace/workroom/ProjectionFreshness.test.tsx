// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProjectionFreshness } from "./ProjectionFreshness";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-21T12:00:00Z")); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("projection freshness", () => {
  it.each([null, "invalid", "2026-09-22T12:00:00Z"])("does not assert freshness for %s", readAt => {
    render(<ProjectionFreshness readAt={readAt} lastEvidenceAt={null} />);
    expect(screen.getByText("Snapshot age unknown.")).toBeInTheDocument();
  });
  it("checks the current clock when a newer server snapshot arrives", () => {
    const { rerender } = render(<ProjectionFreshness readAt="2026-09-21T11:00:00Z" lastEvidenceAt={null} />);
    act(() => vi.setSystemTime(new Date("2026-09-21T12:05:00Z")));
    rerender(<ProjectionFreshness readAt="2026-09-21T12:05:00Z" lastEvidenceAt={null} />);
    expect(screen.getByText("Snapshot read within the last minute.")).toBeInTheDocument();
  });
  it("rechecks elapsed time after a suspended tab returns", () => {
    render(<ProjectionFreshness readAt="2026-09-21T12:00:00Z" lastEvidenceAt={null} />);
    act(() => vi.setSystemTime(new Date("2026-09-21T12:05:00Z")));
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByText(/Snapshot stale/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

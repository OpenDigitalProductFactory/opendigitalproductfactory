// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

const { begin, complete } = vi.hoisted(() => ({ begin: vi.fn(), complete: vi.fn() }));
vi.mock("@/lib/telemetry/journeys", () => ({ beginJourney: begin, completeJourney: complete }));

import { useCoworkerJourneys } from "./use-coworker-journeys";

afterEach(() => {
  cleanup();
  begin.mockClear();
  complete.mockClear();
});

describe("useCoworkerJourneys (BI-BD0B0DCC AC-1)", () => {
  it("times coworker-open from the open commit to the first ready thread", () => {
    const { rerender } = renderHook(({ open, load }) => useCoworkerJourneys(open, load), {
      initialProps: { open: false, load: "ready" },
    });
    complete.mockClear();
    rerender({ open: true, load: "loading" });
    expect(begin).toHaveBeenCalledWith("coworker-open");
    expect(begin).toHaveBeenCalledWith("thread-open");
    rerender({ open: true, load: "ready" });
    expect(complete).toHaveBeenCalledWith("coworker-open");
    expect(complete).toHaveBeenCalledWith("thread-open");
  });

  it("times thread-open for a context switch while the panel stays open", () => {
    const { rerender } = renderHook(({ open, load }) => useCoworkerJourneys(open, load), {
      initialProps: { open: true, load: "ready" },
    });
    begin.mockClear();
    rerender({ open: true, load: "loading" });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(begin).toHaveBeenCalledWith("thread-open");
  });

  it("does not begin a journey while nothing changes", () => {
    const { rerender } = renderHook(({ open, load }) => useCoworkerJourneys(open, load), {
      initialProps: { open: false, load: "ready" },
    });
    rerender({ open: false, load: "ready" });
    expect(begin).not.toHaveBeenCalled();
  });
});

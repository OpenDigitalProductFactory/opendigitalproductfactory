// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelWarmup } from "./ModelWarmup";

describe("ModelWarmup", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanup();
  });

  it("does not perform synthetic report or MCP calls on mount", () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const dispatchSpy = vi.spyOn(document, "dispatchEvent");

    render(<ModelWarmup />);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

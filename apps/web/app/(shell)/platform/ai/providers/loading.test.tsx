// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProvidersLoading from "./loading";
import { withMessages } from "@/test-support/with-messages";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("ProvidersLoading", () => {
  beforeEach(() => refresh.mockClear());
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("reports delayed loading without fabricating a dependency failure", () => {
    vi.useFakeTimers();
    render(withMessages(<ProvidersLoading />));
    expect(screen.getByRole("status", { name: /loading provider data/i })).toBeTruthy();

    act(() => vi.advanceTimersByTime(15_000));

    expect(screen.getByRole("status", { name: /loading provider data/i }).textContent).toMatch(/still loading your connections/i);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/service unavailable|couldn.t load|job service/i)).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes only on an explicit action and starts a new pending cycle", () => {
    vi.useFakeTimers();
    render(withMessages(<ProvidersLoading />));
    act(() => vi.advanceTimersByTime(15_000));
    fireEvent.click(screen.getByRole("button", { name: /refresh page/i }));

    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("status", { name: /loading provider data/i })).toBeTruthy();

    act(() => vi.advanceTimersByTime(14_999));
    expect(screen.getByRole("status", { name: /loading provider data/i })).toBeTruthy();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status", { name: /loading provider data/i }).textContent).toMatch(/still loading your connections/i);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(refresh).toHaveBeenCalledOnce();
  });
});

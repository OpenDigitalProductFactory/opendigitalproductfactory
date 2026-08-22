// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProvidersLoading from "./loading";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("ProvidersLoading", () => {
  beforeEach(() => refresh.mockClear());
  afterEach(() => vi.useRealTimers());

  it("turns an indefinite skeleton into an actionable dependency failure", () => {
    vi.useFakeTimers();
    render(<ProvidersLoading />);
    expect(screen.getByRole("status", { name: /loading provider data/i })).toBeTruthy();

    act(() => vi.advanceTimersByTime(15_000));

    expect(screen.getByRole("alert").textContent).toMatch(/couldn.t load provider data/i);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("status", { name: /loading provider data/i })).toBeTruthy();

    act(() => vi.advanceTimersByTime(14_999));
    expect(screen.getByRole("status", { name: /loading provider data/i })).toBeTruthy();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("alert").textContent).toMatch(/couldn.t load provider data/i);
  });
});

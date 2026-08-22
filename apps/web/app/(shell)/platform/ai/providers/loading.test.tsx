// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProvidersLoading from "./loading";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("ProvidersLoading", () => {
  afterEach(() => vi.useRealTimers());

  it("turns an indefinite skeleton into an actionable dependency failure", () => {
    vi.useFakeTimers();
    render(<ProvidersLoading />);
    expect(screen.getByRole("status", { name: /loading provider data/i })).toBeTruthy();

    act(() => vi.advanceTimersByTime(15_000));

    expect(screen.getByRole("alert").textContent).toMatch(/couldn.t load provider data/i);
    expect(screen.getByRole("button", { name: /try again/i }).hasAttribute("disabled")).toBe(false);
  });
});

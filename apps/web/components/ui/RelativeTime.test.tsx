// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { renderToString } from "react-dom/server";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RelativeTime } from "./RelativeTime";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RelativeTime", () => {
  it("hydrates without a recoverable text mismatch when the minute changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T04:59:59.000Z"));

    const value = "2026-08-13T04:59:00.000Z";
    const serverMarkup = renderToString(<RelativeTime value={value} />);
    const container = document.createElement("div");
    container.innerHTML = serverMarkup;
    document.body.appendChild(container);

    vi.setSystemTime(new Date("2026-08-13T05:00:01.000Z"));
    const recoverableErrors: unknown[] = [];

    render(<RelativeTime value={value} />, {
      container,
      hydrate: true,
      onRecoverableError: (error) => recoverableErrors.push(error),
    });

    expect(recoverableErrors).toEqual([]);
    expect(container).toHaveTextContent("1m ago");
    expect(container.querySelector("time")).toHaveAttribute("aria-label", "1m ago");
  });

  it("updates an ordinary client render to a compact relative label", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T05:00:00.000Z"));
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(<RelativeTime value="2026-08-13T03:00:00.000Z" />, { container });

    expect(container).toHaveTextContent("2h ago");
  });
});

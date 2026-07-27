// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentFAB } from "./AgentFAB";

describe("AgentFAB", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("defaults the collapsed coworker launcher to a lower safe dock", async () => {
    render(<AgentFAB onClick={vi.fn()} />);

    const launcher = await screen.findByRole("button", {
      name: /ai coworker/i,
    });

    await waitFor(() => {
      expect(launcher).toHaveStyle({ top: "82%" });
    });
    expect(launcher).toHaveClass("flex", "h-11", "w-11");
    expect(launcher).not.toHaveClass("hidden");
  });

  it("migrates an old midpoint preference out of the page action lane", async () => {
    localStorage.setItem("agent-fab-y-pct", "50");

    render(<AgentFAB onClick={vi.fn()} />);

    const launcher = await screen.findByRole("button", {
      name: /ai coworker/i,
    });

    await waitFor(() => {
      expect(launcher).toHaveStyle({ top: "72%" });
    });
  });

  it("keeps drag movement inside the lower safe range", async () => {
    render(<AgentFAB onClick={vi.fn()} />);

    const launcher = await screen.findByRole("button", {
      name: /ai coworker/i,
    });

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 1000,
    });

    fireEvent.mouseDown(launcher, { clientY: 820 });
    fireEvent.mouseMove(document, { clientY: 100 });
    fireEvent.mouseUp(document);

    await waitFor(() => {
      expect(launcher).toHaveStyle({ top: "72%" });
    });
    expect(localStorage.getItem("agent-fab-y-pct")).toBe("72");
  });
});

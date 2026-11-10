// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentFAB } from "./AgentFAB";

afterEach(() => { cleanup(); document.body.replaceChildren(); localStorage.clear(); });

describe("coworker launcher", () => {
  it("belongs to the header action slot and leaves routing content clear", async () => {
    const header = document.createElement("header");
    const slot = document.createElement("span");
    slot.dataset.agentLauncherSlot = "true";
    header.append(slot);
    document.body.append(header);
    localStorage.setItem("agent-fab-y-pct", "50");
    const open = vi.fn();
    const { unmount } = render(<AgentFAB onClick={open} />);
    const launcher = await screen.findByRole("button", { name: "Open AI Coworker" });
    expect(slot).toContainElement(launcher);
    expect(launcher).not.toHaveClass("fixed");
    expect(launcher.style.top).toBe("");
    expect(launcher.style.transform).toBe("");
    expect(launcher).toHaveClass("min-h-11", "min-w-11");
    fireEvent.click(launcher);
    expect(open).toHaveBeenCalledTimes(1);
    unmount();
    expect(slot).toBeEmptyDOMElement();
    expect(localStorage.getItem("agent-fab-y-pct")).toBe("50");
  });

  it("falls back to normal document flow when no header is mounted", async () => {
    render(<AgentFAB onClick={vi.fn()} />);
    const launcher = await screen.findByRole("button", { name: "Open AI Coworker" });
    expect(launcher).not.toHaveClass("fixed");
    expect(launcher.style.top).toBe("");
    launcher.focus();
    expect(launcher).toHaveFocus();
  });
});

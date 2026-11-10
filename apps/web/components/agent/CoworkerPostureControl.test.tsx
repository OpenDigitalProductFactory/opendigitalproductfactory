// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CoworkerPostureControl } from "./CoworkerPostureControl";

afterEach(() => cleanup());

describe("CoworkerPostureControl (EP-WORK-POSTURE 8.2)", () => {
  it("renders nothing when there is no mode to switch — no empty Controls menu", () => {
    const { container } = render(<CoworkerPostureControl />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByText("Controls")).toBeNull();
  });

  it("no longer offers per-conversation page-editing or web-access switches", () => {
    render(<CoworkerPostureControl useUnified coworkerMode="advise" onToggleCoworkerMode={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /conversation controls/i }));
    expect(screen.queryByRole("switch", { name: "Edit fields on this page" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Web access" })).toBeNull();
    expect(screen.queryByText("Edit fields on this page")).toBeNull();
    expect(screen.queryByText("Web access")).toBeNull();
  });

  it("summarises the active mode in plain language", () => {
    render(<CoworkerPostureControl useUnified coworkerMode="act" onToggleCoworkerMode={() => {}} />);
    expect(screen.getByText("Act")).toBeTruthy();
  });

  it("shows the Advise/Act segment when unified and fires the mode toggle", () => {
    const onToggleCoworkerMode = vi.fn();
    render(
      <CoworkerPostureControl useUnified coworkerMode="advise" onToggleCoworkerMode={onToggleCoworkerMode} />,
    );
    fireEvent.click(screen.getByText("Advise"));
    fireEvent.click(screen.getAllByText("Act")[0]);
    expect(onToggleCoworkerMode).toHaveBeenCalledTimes(1);
  });

  it("dismisses conversation controls with Escape and returns focus to the trigger", () => {
    render(<CoworkerPostureControl useUnified coworkerMode="advise" onToggleCoworkerMode={() => {}} />);
    const trigger = screen.getByRole("button", { name: /conversation controls/i });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Conversation controls" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Conversation controls" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CoworkerPostureControl } from "./CoworkerPostureControl";

const baseProps = {
  elevatedAssistEnabled: false,
  onToggleElevatedAssist: () => {},
  externalAccessEnabled: false,
  onToggleExternalAccess: () => {},
};

afterEach(() => cleanup());

describe("CoworkerPostureControl", () => {
  it("shows a calm 'Controls' summary at the default posture", () => {
    render(<CoworkerPostureControl {...baseProps} />);
    expect(screen.getByText("Controls")).toBeTruthy();
    expect(screen.queryByText("Edit fields on this page")).toBeNull();
  });

  it("summarises the active posture in plain language", () => {
    render(
      <CoworkerPostureControl
        {...baseProps}
        useUnified
        coworkerMode="act"
        onToggleCoworkerMode={() => {}}
        elevatedAssistEnabled
        externalAccessEnabled
      />,
    );
    expect(screen.getByText("Act · edits on · web on")).toBeTruthy();
  });

  it("reveals real toggle switches when opened (no priority row — that's the dock)", () => {
    render(<CoworkerPostureControl {...baseProps} />);
    fireEvent.click(screen.getByText("Controls"));
    const editSwitch = screen.getByRole("switch", { name: "Edit fields on this page" });
    expect(editSwitch.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "Web access" })).toBeTruthy();
  });

  it("fires the page-editing toggle through the switch", () => {
    const onToggleElevatedAssist = vi.fn();
    render(<CoworkerPostureControl {...baseProps} onToggleElevatedAssist={onToggleElevatedAssist} />);
    fireEvent.click(screen.getByText("Controls"));
    fireEvent.click(screen.getByRole("switch", { name: "Edit fields on this page" }));
    expect(onToggleElevatedAssist).toHaveBeenCalledTimes(1);
  });

  it("shows the Advise/Act mode segment only when unified", () => {
    render(
      <CoworkerPostureControl {...baseProps} useUnified coworkerMode="advise" onToggleCoworkerMode={() => {}} />,
    );
    fireEvent.click(screen.getByText("Advise"));
    expect(screen.getAllByText("Act").length).toBeGreaterThan(0);
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AgentPanelHeader } from "./AgentPanelHeader";

vi.mock("./AgentSkillsDropdown", () => ({
  AgentSkillsDropdown: () => <span>Skills</span>,
}));

// The posture menu hosts the coworker priority chip; stub it so this header
// render test stays focused on the header's own structure (and doesn't pull the
// chip's server actions).
vi.mock("@/components/golden-triangle/CoworkerPriorityControl", () => ({
  CoworkerPriorityControl: () => <span>Priority control</span>,
}));

const baseProps = {
  agent: {
    agentId: "agent-1",
    agentName: "Ops Co-worker",
    agentDescription: "Helps with operations",
    canAssist: true,
    sensitivity: "internal" as const,
    systemPrompt: "prompt",
    skills: [],
  },
  userContext: { userId: "user-1", platformRole: "OPS-100", isSuperuser: false },
  onSend: () => {},
  onOpenClearConfirm: () => {},
  onCancelClearConfirm: () => {},
  onConfirmClear: () => {},
  clearDisabled: false,
  clearConfirmOpen: false,
  elevatedAssistEnabled: false,
  onToggleElevatedAssist: () => {},
  externalAccessEnabled: false,
  onToggleExternalAccess: () => {},
  onClose: () => {},
  onDragStart: () => {},
};

afterEach(() => cleanup());

describe("AgentPanelHeader", () => {
  it("renders a calm resting header: identity, one sensitivity tag, and a Controls summary", () => {
    render(<AgentPanelHeader {...baseProps} />);
    expect(screen.getByText("Ops Co-worker")).toBeTruthy();
    // Session toggles are no longer resting chips — they live behind the posture control.
    expect(screen.getByText("Controls")).toBeTruthy();
    // The duplicate sensitivity badge is gone: exactly one "Internal" indicator.
    expect(screen.getAllByText("Internal")).toHaveLength(1);
    // Toggle labels stay hidden until the posture menu is opened.
    expect(screen.queryByText("Edit fields on this page")).toBeNull();
  });

  it("summarises the active posture in plain language", () => {
    render(
      <AgentPanelHeader
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

  it("reveals real toggle switches when the posture control is opened", () => {
    render(<AgentPanelHeader {...baseProps} />);
    fireEvent.click(screen.getByText("Controls"));
    const editSwitch = screen.getByRole("switch", { name: "Edit fields on this page" });
    expect(editSwitch.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "Web access" })).toBeTruthy();
  });

  it("fires the page-editing toggle through the switch", () => {
    const onToggleElevatedAssist = vi.fn();
    render(<AgentPanelHeader {...baseProps} onToggleElevatedAssist={onToggleElevatedAssist} />);
    fireEvent.click(screen.getByText("Controls"));
    fireEvent.click(screen.getByRole("switch", { name: "Edit fields on this page" }));
    expect(onToggleElevatedAssist).toHaveBeenCalledTimes(1);
  });

  it("shows the Advise/Act mode segment only when unified, inside the posture menu", () => {
    render(
      <AgentPanelHeader {...baseProps} useUnified coworkerMode="advise" onToggleCoworkerMode={() => {}} />,
    );
    // The resting summary reads "Advise"; clicking it opens the posture menu.
    fireEvent.click(screen.getByText("Advise"));
    expect(screen.getAllByText("Act").length).toBeGreaterThan(0);
  });

  it("moves profile, diagnostics, and erase into the overflow menu and points dev work to Build Studio", () => {
    const onOpenClearConfirm = vi.fn();
    render(
      <AgentPanelHeader
        {...baseProps}
        canUseDev
        devMode={false}
        onToggleDev={() => {}}
        onViewProfile={() => {}}
        onOpenClearConfirm={onOpenClearConfirm}
      />,
    );
    // Secondary actions are not in the resting header.
    expect(screen.queryByText("Erase conversation")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getByText("View profile, skills & tools")).toBeTruthy();
    const diagnostics = screen.getByRole("button", { name: "Diagnostics" });
    expect(diagnostics.getAttribute("title")).toContain("Use Build Studio for code-changing work");
    fireEvent.click(screen.getByRole("button", { name: "Erase conversation" }));
    expect(onOpenClearConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders the inline erase confirmation popover when open", () => {
    render(<AgentPanelHeader {...baseProps} clearConfirmOpen />);
    expect(screen.getByText("Erase this page conversation?")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
    expect(screen.getByText("Erase now")).toBeTruthy();
  });
});

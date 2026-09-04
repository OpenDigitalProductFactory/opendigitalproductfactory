// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AgentPanelHeader } from "./AgentPanelHeader";

vi.mock("./AgentSkillsDropdown", () => ({
  AgentSkillsDropdown: () => <span>Skills</span>,
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
  onClose: () => {},
  onDragStart: () => {},
};

afterEach(() => cleanup());

describe("AgentPanelHeader", () => {
  it("renders a calm resting header: identity, one sensitivity tag, and an overflow trigger", () => {
    render(<AgentPanelHeader {...baseProps} />);
    expect(screen.getByText("Ops Co-worker")).toBeTruthy();
    // The duplicate sensitivity badge is gone: exactly one "Internal" indicator.
    expect(screen.getAllByText("Internal")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "More options" })).toBeTruthy();
    expect(screen.getByText("Helps with operations").className).toContain("hidden sm:inline");
    // Posture now lives in the composer lip, not the header.
    expect(screen.queryByText("Controls")).toBeNull();
    expect(screen.queryByText("Edit fields on this page")).toBeNull();
  });

  it("renders a conversational name as primary and the coworker role once as secondary", () => {
    render(
      <AgentPanelHeader
        {...baseProps}
        presentationIdentity={{ primaryName: "Coolio", roleName: "AI COO" }}
      />,
    );
    expect(screen.getByText("Coolio")).toBeTruthy();
    expect(screen.getAllByText("AI COO")).toHaveLength(1);
    expect(screen.queryByText("Coolio · AI COO")).toBeNull();
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

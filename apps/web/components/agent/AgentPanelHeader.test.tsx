import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentPanelHeader } from "./AgentPanelHeader";

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
  onClose: () => {},
  onDragStart: () => {},
};

describe("AgentPanelHeader", () => {
  it("renders Hands Off when elevated assist is disabled", () => {
    const html = renderToStaticMarkup(
      <AgentPanelHeader {...baseProps} />,
    );

    expect(html).toContain("Hands Off");
  });

  it("renders a yellow Hands On indicator when elevated assist is enabled", () => {
    const html = renderToStaticMarkup(
      <AgentPanelHeader
        {...baseProps}
        agent={{ ...baseProps.agent, sensitivity: "restricted" }}
        elevatedAssistEnabled
      />,
    );

    expect(html).toContain("Hands On");
    expect(html).toContain("Restricted");
  });

  it("renders an inline erase confirmation popover when open", () => {
    const html = renderToStaticMarkup(
      <AgentPanelHeader {...baseProps} clearConfirmOpen />,
    );

    expect(html).toContain("Erase this page conversation?");
    expect(html).toContain("Cancel");
    expect(html).toContain("Erase now");
  });
});

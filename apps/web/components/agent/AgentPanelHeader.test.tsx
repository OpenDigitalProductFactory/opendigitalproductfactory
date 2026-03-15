import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentPanelHeader } from "./AgentPanelHeader";

describe("AgentPanelHeader", () => {
  it("renders Hands Off when elevated assist is disabled", () => {
    const html = renderToStaticMarkup(
      <AgentPanelHeader
        agent={{
          agentId: "agent-1",
          agentName: "Ops Co-worker",
          agentDescription: "Helps with operations",
          canAssist: true,
          sensitivity: "internal",
          systemPrompt: "prompt",
          skills: [],
        }}
        userContext={{ userId: "user-1", platformRole: "OPS-100", isSuperuser: false }}
        onSend={() => {}}
        onClear={() => {}}
        clearDisabled={false}
        elevatedAssistEnabled={false}
        onToggleElevatedAssist={() => {}}
        onClose={() => {}}
        onDragStart={() => {}}
      />,
    );

    expect(html).toContain("Hands Off");
  });

  it("renders a yellow Hands On indicator when elevated assist is enabled", () => {
    const html = renderToStaticMarkup(
      <AgentPanelHeader
        agent={{
          agentId: "agent-1",
          agentName: "Ops Co-worker",
          agentDescription: "Helps with operations",
          canAssist: true,
          sensitivity: "restricted",
          systemPrompt: "prompt",
          skills: [],
        }}
        userContext={{ userId: "user-1", platformRole: "OPS-100", isSuperuser: false }}
        onSend={() => {}}
        onClear={() => {}}
        clearDisabled={false}
        elevatedAssistEnabled
        onToggleElevatedAssist={() => {}}
        onClose={() => {}}
        onDragStart={() => {}}
      />,
    );

    expect(html).toContain("Hands On");
    expect(html).toContain("Restricted");
  });
});

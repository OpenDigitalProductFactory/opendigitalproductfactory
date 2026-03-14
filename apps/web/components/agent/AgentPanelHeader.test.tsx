import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentPanelHeader } from "./AgentPanelHeader";

describe("AgentPanelHeader", () => {
  it("renders an erase control for the current conversation", () => {
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

    expect(html).toContain("Erase");
  });

  it("renders a yellow elevated assist indicator when form fill is enabled", () => {
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

    expect(html).toContain("Form fill enabled");
    expect(html).toContain("Restricted");
  });
});

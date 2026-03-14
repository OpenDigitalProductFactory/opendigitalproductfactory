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
          systemPrompt: "prompt",
          skills: [],
        }}
        userContext={{ platformRole: "OPS-100", isSuperuser: false }}
        onSend={() => {}}
        onClear={() => {}}
        clearDisabled={false}
        onClose={() => {}}
        onDragStart={() => {}}
      />,
    );

    expect(html).toContain("Erase");
  });
});

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentMessageBubble } from "./AgentMessageBubble";

describe("AgentMessageBubble", () => {
  it("renders assistant markdown as structured HTML", () => {
    const html = renderToStaticMarkup(
      <AgentMessageBubble
        message={{
          id: "msg-1",
          role: "assistant",
          content: "**Agents** help with:\n\n- automation\n- workflow management",
          agentId: "ops-coordinator",
          routeContext: "/ops",
          createdAt: "2026-03-14T12:00:00.000Z",
        }}
        showAgentLabel={true}
        agentName="Ops Coordinator"
      />,
    );

    expect(html).toContain("<strong");
    expect(html).toContain("Agents</strong>");
    expect(html).toContain("<ul");
    expect(html).toContain("automation</li>");
    expect(html).not.toContain("**Agents**");
  });

  it("keeps user messages as plain text bubbles", () => {
    const html = renderToStaticMarkup(
      <AgentMessageBubble
        message={{
          id: "msg-2",
          role: "user",
          content: "**raw** user text",
          agentId: null,
          routeContext: "/ops",
          createdAt: "2026-03-14T12:00:00.000Z",
        }}
        showAgentLabel={false}
        agentName={null}
      />,
    );

    expect(html).toContain("**raw** user text");
    expect(html).not.toContain("<strong>raw</strong>");
  });
});

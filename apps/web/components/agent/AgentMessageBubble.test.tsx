import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentMessageBubble,
  formatProviderBadge,
  stripSystemPromptPrefix,
} from "./AgentMessageBubble";

describe("formatProviderBadge", () => {
  it("returns null when no provider is attached", () => {
    expect(formatProviderBadge(undefined)).toBeNull();
  });

  it("renders provider name plus model for API adapters", () => {
    expect(
      formatProviderBadge({
        name: "Anthropic",
        modelId: "claude-opus-4-7",
        adapterKind: "anthropic-api",
      }),
    ).toBe("Anthropic · claude-opus-4-7");
  });

  it("appends ' CLI' for CLI adapters", () => {
    expect(
      formatProviderBadge({
        name: "ChatGPT",
        modelId: "gpt-5-codex",
        adapterKind: "codex-cli",
      }),
    ).toBe("ChatGPT CLI · gpt-5-codex");
  });

  it("does not double-stamp CLI when the provider name already says CLI", () => {
    expect(
      formatProviderBadge({
        name: "Codex CLI",
        modelId: "gpt-5-codex",
        adapterKind: "codex-cli",
      }),
    ).toBe("Codex CLI · gpt-5-codex");
  });

  it("renders provider name alone when model is missing (fallback path)", () => {
    expect(
      formatProviderBadge({
        name: "Anthropic",
        modelId: null,
        adapterKind: null,
      }),
    ).toBe("Anthropic");
  });
});

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

  it("renders a sending status for optimistic user messages", () => {
    const html = renderToStaticMarkup(
      <AgentMessageBubble
        message={{
          id: "msg-3",
          role: "user",
          content: "Drafting a change request",
          agentId: null,
          routeContext: "/ops",
          createdAt: "2026-03-14T12:00:00.000Z",
        }}
        showAgentLabel={false}
        agentName={null}
        deliveryState="sending"
      />,
    );

    expect(html).toContain("Sending...");
  });

  it("renders a failed status and retry action for unsent user messages", () => {
    const html = renderToStaticMarkup(
      <AgentMessageBubble
        message={{
          id: "msg-4",
          role: "user",
          content: "Please update the backlog item",
          agentId: null,
          routeContext: "/ops",
          createdAt: "2026-03-14T12:00:00.000Z",
        }}
        showAgentLabel={false}
        agentName={null}
        deliveryState="failed"
        onRetry={() => {}}
      />,
    );

    expect(html).toContain("Not sent");
    expect(html).toContain("Retry");
  });

  it("renders the provider badge inline with the agent name on assistant turns", () => {
    const html = renderToStaticMarkup(
      <AgentMessageBubble
        message={{
          id: "msg-prov-1",
          role: "assistant",
          content: "Routed answer.",
          agentId: "software-engineer",
          routeContext: "/build",
          createdAt: "2026-05-22T12:00:00.000Z",
          provider: {
            name: "ChatGPT",
            modelId: "gpt-5-codex",
            adapterKind: "codex-cli",
          },
        }}
        showAgentLabel={true}
        agentName="Software Engineer"
      />,
    );

    expect(html).toContain("Software Engineer");
    expect(html).toContain("ChatGPT CLI · gpt-5-codex");
    expect(html).toContain('data-testid="agent-message-provider"');
  });

  it("omits the provider badge when no provider info is attached", () => {
    const html = renderToStaticMarkup(
      <AgentMessageBubble
        message={{
          id: "msg-prov-2",
          role: "assistant",
          content: "Legacy answer with no telemetry.",
          agentId: "ops-coordinator",
          routeContext: "/ops",
          createdAt: "2026-05-22T12:00:00.000Z",
        }}
        showAgentLabel={true}
        agentName="Ops Coordinator"
      />,
    );

    expect(html).toContain("Ops Coordinator");
    expect(html).not.toContain('data-testid="agent-message-provider"');
  });

  it("omits the provider badge on user messages even if provider were set", () => {
    const html = renderToStaticMarkup(
      <AgentMessageBubble
        message={{
          id: "msg-prov-3",
          role: "user",
          content: "user text",
          agentId: null,
          routeContext: "/ops",
          createdAt: "2026-05-22T12:00:00.000Z",
          // user messages shouldn't carry provider, but defensive check
          provider: { name: "Anthropic", modelId: "claude-opus-4-7", adapterKind: "anthropic-api" },
        }}
        showAgentLabel={false}
        agentName={null}
      />,
    );

    expect(html).not.toContain('data-testid="agent-message-provider"');
  });

  it("renders managed document chips for assistant messages with stable document ids", () => {
    const html = renderToStaticMarkup(
      <AgentMessageBubble
        message={{
          id: "msg-5",
          role: "assistant",
          content: "Saved document DOC-ABC12345 v1: /workspace/documents/DOC-ABC12345.",
          agentId: "policy-coworker",
          routeContext: "/workspace",
          createdAt: "2026-03-14T12:00:00.000Z",
        }}
        showAgentLabel={true}
        agentName="Policy"
      />,
    );

    expect(html).toContain("/workspace/documents/DOC-ABC12345");
    expect(html).toContain("DOC-ABC12345");
  });
});

describe("stripSystemPromptPrefix (BI-253ADC70 D5/D9)", () => {
  it("strips a leading [Setup step: ...] tag", () => {
    expect(
      stripSystemPromptPrefix(
        "[Setup step: Workspace — day-to-day operations and guardrails] Welcome to your workspace.",
      ),
    ).toBe("Welcome to your workspace.");
  });

  it("preserves the message when no setup tag is present", () => {
    expect(stripSystemPromptPrefix("Welcome to your workspace.")).toBe(
      "Welcome to your workspace.",
    );
  });

  it("only strips at the START of the string (mid-string tags survive)", () => {
    expect(
      stripSystemPromptPrefix("Welcome. [Setup step: ...] is operational."),
    ).toBe("Welcome. [Setup step: ...] is operational.");
  });

  it("strips trailing whitespace and newlines that follow the tag", () => {
    expect(
      stripSystemPromptPrefix(
        "[Setup step: x]\n\n  Real content starts here.",
      ),
    ).toBe("Real content starts here.");
  });

  it("handles an empty string", () => {
    expect(stripSystemPromptPrefix("")).toBe("");
  });
});

describe("AgentMessageBubble — system-prompt prefix strip (BI-253ADC70 D5/D9)", () => {
  it("strips the [Setup step: ...] prefix from assistant content before rendering", () => {
    const html = renderToStaticMarkup(
      <AgentMessageBubble
        message={{
          id: "msg-leak",
          role: "assistant",
          content:
            "[Setup step: Workspace — day-to-day operations and guardrails] Welcome to your workspace. This is where you'll manage day-to-day operations.",
          agentId: "ops-coordinator",
          routeContext: "/ops",
          createdAt: "2026-06-03T05:00:00.000Z",
        }}
        showAgentLabel={true}
        agentName="Ops Coordinator"
      />,
    );

    expect(html).not.toContain("[Setup step:");
    expect(html).toContain("Welcome to your workspace");
  });

  it("does NOT strip [Setup step: ...] from user messages (keeps user intent verbatim)", () => {
    const html = renderToStaticMarkup(
      <AgentMessageBubble
        message={{
          id: "msg-user",
          role: "user",
          content: "[Setup step: literal text the user typed] What does this mean?",
          agentId: null,
          routeContext: null,
          createdAt: "2026-06-03T05:00:00.000Z",
        }}
        showAgentLabel={false}
        agentName={null}
      />,
    );

    // User-typed content is preserved verbatim so we cannot lose user intent.
    expect(html).toContain("[Setup step:");
  });
});

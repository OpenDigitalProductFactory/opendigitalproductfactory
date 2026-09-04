import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentMessageBubble,
  formatProviderBadge,
  referencesProviderRoutingSurface,
  stripSystemPromptPrefix,
  PROVIDER_ROUTING_ROUTE,
} from "./AgentMessageBubble";

describe("formatProviderBadge", () => {
  it("returns null when no provider is attached", () => {
    expect(formatProviderBadge(undefined)).toBeNull();
  });

  it("renders a friendly provider+model label with the raw id on hover (API adapters)", () => {
    expect(
      formatProviderBadge({
        name: "Anthropic",
        providerId: "anthropic",
        modelId: "claude-opus-4-8",
        adapterKind: "anthropic-api",
      }),
    ).toEqual({ label: "Claude · Opus 4.8", title: "anthropic / claude-opus-4-8" });
  });

  it("appends ' CLI' for CLI adapters and keeps the raw id in the title", () => {
    expect(
      formatProviderBadge({
        name: "ChatGPT",
        providerId: "openai",
        modelId: "gpt-5-codex",
        adapterKind: "codex-cli",
      }),
    ).toEqual({ label: "ChatGPT CLI · GPT-5 Codex", title: "openai / gpt-5-codex" });
  });

  it("does not double-stamp CLI when the label already says CLI", () => {
    const badge = formatProviderBadge({
      name: "Codex CLI",
      providerId: "openai",
      modelId: "gpt-5-codex",
      adapterKind: "codex-cli",
    });
    expect(badge?.label).not.toMatch(/CLI.*CLI/);
  });

  it("renders the provider label alone when model is missing (fallback path)", () => {
    expect(
      formatProviderBadge({
        name: "Anthropic",
        providerId: "anthropic",
        modelId: null,
        adapterKind: null,
      }),
    ).toEqual({ label: "Claude", title: "anthropic" });
  });
});

describe("AgentMessageBubble", () => {
  it("announces system recovery messages as status updates", () => {
    const html = renderToStaticMarkup(
      <AgentMessageBubble
        message={{
          id: "provider-consultation-failed",
          role: "system",
          content: "Provider posture was not changed; try again or request qualified review.",
          agentId: null,
          routeContext: "/workspace",
          createdAt: "2026-07-20T00:00:00.000Z",
        }}
        showAgentLabel={false}
        agentName={null}
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Provider posture was not changed");
  });

  it("renders provider recovery as a system card without coworker attribution", () => {
    const html = renderToStaticMarkup(
      <AgentMessageBubble
        message={{
          id: "routing-failed",
          role: "system",
          content:
            "The selected AI model is no longer available from its provider, so the platform could not answer this turn. Open Providers & Routing.",
          agentId: null,
          routeContext: "/workspace",
          createdAt: "2026-08-24T00:00:00.000Z",
        }}
        showAgentLabel={false}
        agentName={null}
      />,
    );
    expect(html).toContain('data-message-role="system"');
    expect(html).toContain('data-testid="agent-provider-reconnect-cta"');
    expect(html.match(/Providers &amp; Routing/g)).toHaveLength(1);
    expect(html).not.toContain('data-message-role="assistant"');
  });

  it("does not add recovery controls to unrelated system notices that mention provider routing", () => {
    const html = renderToStaticMarkup(
      <AgentMessageBubble
        message={{
          id: "build-studio-routing-note",
          role: "system",
          content: "Build Runtime and Providers & Routing govern different phases.",
          agentId: null,
          routeContext: "/platform/ai/build-studio",
          createdAt: "2026-08-24T00:00:00.000Z",
        }}
        showAgentLabel={false}
        agentName={null}
      />,
    );
    expect(html).toContain('data-message-role="system"');
    expect(html).not.toContain('data-testid="agent-provider-reconnect-cta"');
  });

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

  it("keeps assistant authorship accessible when the visual label is suppressed", () => {
    const html = renderToStaticMarkup(
      <AgentMessageBubble
        message={{
          id: "msg-accessible-author",
          role: "assistant",
          content: "I can help with that.",
          agentId: "AGT-ORCH-000",
          routeContext: "/workspace",
          createdAt: "2026-08-24T00:00:00.000Z",
        }}
        showAgentLabel={false}
        agentName="Coolio"
      />,
    );

    expect(html).toContain('aria-label="Message from Coolio"');
    expect(html).not.toMatch(/>Coolio<\/span>/);
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
            providerId: "openai",
            modelId: "gpt-5-codex",
            adapterKind: "codex-cli",
          },
        }}
        showAgentLabel={true}
        agentName="Software Engineer"
      />,
    );

    expect(html).toContain("Software Engineer");
    expect(html).toContain("ChatGPT CLI · GPT-5 Codex");
    expect(html).toContain('data-testid="agent-message-provider"');
    // Progressive disclosure: the full raw model id lives in the hover title.
    expect(html).toContain('title="openai / gpt-5-codex"');
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

  it("renders a one-click reconnect CTA when an assistant message names Providers & Routing (BI-282C39D5)", () => {
    // The exact honest-failure string from describeToolRouteFailure (agentic-loop.ts).
    const html = renderToStaticMarkup(
      <AgentMessageBubble
        message={{
          id: "msg-cta",
          role: "assistant",
          content:
            "No AI model can handle this request right now. This usually means your cloud AI providers are disconnected or their sign-in has expired, and the built-in local model can't fit this assistant's larger requests on its own. Open Platform > AI Operations > Providers & Routing to reconnect a provider — waiting won't clear this on its own.",
          agentId: "scrum-master",
          routeContext: "/platform/ai/providers",
          createdAt: "2026-07-14T12:00:00.000Z",
        }}
        showAgentLabel={true}
        agentName="Scrum Master"
      />,
    );

    expect(html).toContain('data-testid="agent-provider-reconnect-cta"');
    expect(html).toContain(`href="${PROVIDER_ROUTING_ROUTE}"`);
    expect(html).toContain("Open Providers");
  });

  it("does NOT render the reconnect CTA for a normal assistant message", () => {
    const html = renderToStaticMarkup(
      <AgentMessageBubble
        message={{
          id: "msg-no-cta",
          role: "assistant",
          content: "Here's a summary of today's standup and the three blockers.",
          agentId: "scrum-master",
          routeContext: "/ops",
          createdAt: "2026-07-14T12:00:00.000Z",
        }}
        showAgentLabel={true}
        agentName="Scrum Master"
      />,
    );

    expect(html).not.toContain('data-testid="agent-provider-reconnect-cta"');
  });

  it("does NOT render the reconnect CTA on a user message that happens to name the surface", () => {
    const html = renderToStaticMarkup(
      <AgentMessageBubble
        message={{
          id: "msg-user-cta",
          role: "user",
          content: "where is Providers & Routing?",
          agentId: null,
          routeContext: "/ops",
          createdAt: "2026-07-14T12:00:00.000Z",
        }}
        showAgentLabel={false}
        agentName={null}
      />,
    );

    expect(html).not.toContain('data-testid="agent-provider-reconnect-cta"');
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

describe("referencesProviderRoutingSurface (BI-282C39D5)", () => {
  it("matches every provider-config remediation phrasing", () => {
    expect(referencesProviderRoutingSurface("Open Platform > AI > Providers & Routing to activate a tool-capable provider, then try again.")).toBe(true);
    expect(referencesProviderRoutingSurface("Open Platform › AI Operations › Providers & Routing, connect a cloud provider")).toBe(true);
    expect(referencesProviderRoutingSurface("… Open Platform > AI Operations > Providers & Routing to reconnect a provider — waiting won't clear this on its own.")).toBe(true);
  });

  it("does not match normal conversation", () => {
    expect(referencesProviderRoutingSurface("Here are the three standup blockers.")).toBe(false);
    expect(referencesProviderRoutingSurface("")).toBe(false);
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

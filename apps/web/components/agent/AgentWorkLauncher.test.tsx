import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseState } = vi.hoisted(() => ({
  mockUseState: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: mockUseState,
  };
});

import { AgentWorkLauncher, dispatchAgentPrompt } from "./AgentWorkLauncher";

const topics = [
  {
    id: "strategy",
    label: "Strategy",
    description: "Review the market, buyer, proof, and sales motion.",
    prompt: "Run a marketing review.",
    contextSummary: "Uses business, storefront, and strategy context.",
    expectedNextStep: "The strategist will ask one focused question.",
  },
  {
    id: "proof",
    label: "Proof",
    description: "Choose the credibility signals to build first.",
    prompt: "Plan proof of expertise.",
    contextSummary: "Uses current proof and offer context.",
    expectedNextStep: "The strategist will identify the first proof asset.",
  },
];

function renderLauncher() {
  return renderToStaticMarkup(
    AgentWorkLauncher({
      agentName: "Marketing Strategist",
      primaryActionLabel: "Start marketing review",
      topics,
    }),
  );
}

describe("AgentWorkLauncher", () => {
  beforeEach(() => {
    mockUseState.mockImplementation((initialState: unknown) => [initialState, vi.fn()]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockUseState.mockReset();
  });

  it("server-renders with one clear primary action and no hidden auto-send state", () => {
    const html = renderLauncher();

    expect(html).toContain("Start marketing review");
    expect(html).toContain("Choose where to start");
    expect(html).not.toContain("data-confirm-agent-work");
  });

  it("renders the selected topic preview when a topic is already chosen", () => {
    mockUseState.mockImplementation(() => ["proof", vi.fn()]);

    const html = renderLauncher();

    expect(html).toContain("Plan proof of expertise.");
    expect(html).toContain("The strategist will identify the first proof asset.");
    expect(html).toContain("data-confirm-agent-work=\"true\"");
  });

  it("dispatches one open-agent-panel event with the prompt payload", () => {
    const previousDocument = globalThis.document;
    const dispatchEvent = vi.fn();
    globalThis.document = {
      dispatchEvent,
    } as unknown as Document;

    try {
      dispatchAgentPrompt("Run a marketing review.");

      expect(dispatchEvent).toHaveBeenCalledTimes(1);
      const event = dispatchEvent.mock.calls[0][0] as CustomEvent;
      expect(event.type).toBe("open-agent-panel");
      expect(event.detail).toEqual({
        autoMessage: "Run a marketing review.",
      });
    } finally {
      globalThis.document = previousDocument;
    }
  });
});

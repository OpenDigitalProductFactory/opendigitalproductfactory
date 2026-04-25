import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentWorkLauncher } from "./AgentWorkLauncher";

type TestRendererInstance = {
  root: {
    findByProps: (props: Record<string, string>) => { props: { onClick: () => void } };
  };
  toJSON: () => unknown;
  unmount: () => void;
};

const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => TestRendererInstance;
};

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
  const previousDocument = globalThis.document;
  const dispatchEvent = vi.fn();
  globalThis.document = {
    dispatchEvent,
  } as unknown as Document;

  let renderer: TestRendererInstance | null = null;
  act(() => {
    renderer = TestRenderer.create(
      <AgentWorkLauncher
        agentName="Marketing Strategist"
        primaryActionLabel="Start marketing review"
        topics={topics}
      />,
    );
  });

  return {
    dispatchEvent,
    get renderer() {
      if (!renderer) throw new Error("renderer not initialized");
      return renderer;
    },
    cleanup: () => {
      act(() => renderer?.unmount());
      globalThis.document = previousDocument;
    },
  };
}

describe("AgentWorkLauncher", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the selected topic preview without sending a coworker prompt", () => {
    const { renderer, dispatchEvent, cleanup } = renderLauncher();

    try {
      act(() => {
        renderer.root.findByProps({ "data-topic-id": "proof" }).props.onClick();
      });

      const tree = JSON.stringify(renderer.toJSON());
      expect(tree).toContain("Plan proof of expertise.");
      expect(tree).toContain("The strategist will identify the first proof asset.");
      expect(dispatchEvent).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("dispatches one open-agent-panel event only after explicit confirmation", () => {
    const { renderer, dispatchEvent, cleanup } = renderLauncher();

    try {
      act(() => {
        renderer.root.findByProps({ "data-topic-id": "strategy" }).props.onClick();
      });
      expect(dispatchEvent).not.toHaveBeenCalled();

      act(() => {
        renderer.root.findByProps({ "data-confirm-agent-work": "true" }).props.onClick();
      });

      expect(dispatchEvent).toHaveBeenCalledTimes(1);
      const event = dispatchEvent.mock.calls[0][0] as CustomEvent;
      expect(event.type).toBe("open-agent-panel");
      expect(event.detail).toEqual({
        autoMessage: "Run a marketing review.",
      });
    } finally {
      cleanup();
    }
  });

  it("server-renders with one clear primary action and no hidden auto-send state", () => {
    const { renderer, cleanup } = renderLauncher();

    try {
      const tree = JSON.stringify(renderer.toJSON());
      expect(tree).toContain("Start marketing review");
      expect(tree).toContain("Choose where to start");
      expect(tree).not.toContain("data-confirm-agent-work");
    } finally {
      cleanup();
    }
  });
});

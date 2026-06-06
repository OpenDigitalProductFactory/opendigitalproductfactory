// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AiFinanceCoworkerAskButton } from "./AiFinanceCoworkerAskButton";

describe("AiFinanceCoworkerAskButton", () => {
  it("opens the Finance Specialist coworker panel with route context", () => {
    const handler = vi.fn();
    document.addEventListener("open-agent-panel", handler as EventListener);

    try {
      render(
        <AiFinanceCoworkerAskButton
          prompt="Ask for Claude billing detail."
          routeContext="/finance/spend/ai"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /ask finance specialist/i }));

      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual({
        autoMessage: "Ask for Claude billing detail.",
        routeContext: "/finance/spend/ai",
      });
    } finally {
      document.removeEventListener("open-agent-panel", handler as EventListener);
    }
  });
});

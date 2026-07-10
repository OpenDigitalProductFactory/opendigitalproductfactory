// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AskCoworkerButton } from "./AskCoworkerButton";

afterEach(cleanup);

describe("AskCoworkerButton", () => {
  it("dispatches open-agent-panel with the prompt and routeContext", () => {
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    document.addEventListener("open-agent-panel", handler);

    render(
      <AskCoworkerButton prompt="Sandbox is offline — diagnose it" routeContext="/admin" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask coworker" }));

    document.removeEventListener("open-agent-panel", handler);
    expect(events).toHaveLength(1);
    expect(events[0].detail).toEqual({
      autoMessage: "Sandbox is offline — diagnose it",
      routeContext: "/admin",
    });
  });

  it("omits routeContext when not given and renders custom children", () => {
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    document.addEventListener("open-agent-panel", handler);

    render(
      <AskCoworkerButton prompt="p">
        <span>provider down — ask</span>
      </AskCoworkerButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "provider down — ask" }));

    document.removeEventListener("open-agent-panel", handler);
    expect(events).toHaveLength(1);
    expect(events[0].detail).toEqual({ autoMessage: "p" });
  });
});

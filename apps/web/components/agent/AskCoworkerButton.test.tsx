// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AskCoworkerButton } from "./AskCoworkerButton";
import { buildProviderReviewPacket } from "@/lib/routing/provider-suitability/provider-review-packet";

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

  it("can open a selected coworker without sending a message for the user", () => {
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    document.addEventListener("open-agent-panel", handler);

    render(
      <AskCoworkerButton
        label="Ask this coworker"
        routeContext="/platform/ai/agent/customer-advisor"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Ask this coworker" }),
    );

    document.removeEventListener("open-agent-panel", handler);
    expect(events).toHaveLength(1);
    expect(events[0].detail).toEqual({
      routeContext: "/platform/ai/agent/customer-advisor",
    });
  });

  it("carries an optional validated provider-review packet for deterministic dispatch", () => {
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    document.addEventListener("open-agent-panel", handler);
    const packet = buildProviderReviewPacket({
      businessProfile: {
        organizationId: "org-1",
        archetypeId: null,
        archetypeCategory: null,
        operatesIn: [],
        sellsTo: [],
        employsIn: [],
        dataResidency: [],
        riskPosture: null,
      },
      recommendation: { status: "not-ready", workloadClasses: [], items: [] },
    });

    render(
      <AskCoworkerButton
        prompt="Review provider setup"
        routeContext="/workspace"
        providerReviewPacket={packet}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask coworker" }));

    document.removeEventListener("open-agent-panel", handler);
    expect(events[0]?.detail).toEqual({
      autoMessage: "Review provider setup",
      routeContext: "/workspace",
      providerReviewPacket: packet,
    });
  });

  it("previews context and requires confirmation before dispatch", () => {
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    document.addEventListener("open-agent-panel", handler);

    render(
      <AskCoworkerButton
        prompt="Review provider setup"
        routeContext="/workspace"
        confirmation={{
          title: "Review what your COO will receive",
          contextSummary: "Provider recommendation and safeguard evidence.",
          expectedNextStep: "A short answer and one next action.",
          confirmLabel: "Send to my COO",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ask coworker" }));
    expect(events).toHaveLength(0);
    expect(screen.getByRole("region", { name: "Review what your COO will receive" })).toBeTruthy();
    expect(screen.getByText("Provider recommendation and safeguard evidence.")).toBeTruthy();
    expect(screen.getByText("A short answer and one next action.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send to my COO" }));
    document.removeEventListener("open-agent-panel", handler);
    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toEqual({
      autoMessage: "Review provider setup",
      routeContext: "/workspace",
    });
  });
});

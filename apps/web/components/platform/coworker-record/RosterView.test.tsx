// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RosterView } from "./RosterView";
import type {
  RosterFacets,
  RosterRow,
} from "@/lib/coworker-record/roster";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  window.history.replaceState({}, "", "/platform/ai/overview");
});
afterEach(cleanup);

const facets: RosterFacets = {
  families: [],
  valueStreams: [],
  jurisdictions: [],
  competencies: [],
  lifecycleStages: ["production"],
};

function row(over: Partial<RosterRow> = {}): RosterRow {
  return {
    agentId: "customer-advisor",
    slugId: "customer-advisor",
    name: "Customer Advisor",
    displayName: "Customer Advisor",
    kind: "advisor",
    tier: 2,
    valueStream: "consume",
    lifecycleStage: "production",
    plainJob: "Handles customer intake and follow-up.",
    workSearchText: "Customer intake Customer follow-up",
    canStartConversation: true,
    area: {
      key: "products_and_services_sold",
      label: "Customers and sales",
      order: 1,
    },
    areas: [
      {
        key: "products_and_services_sold",
        label: "Customers and sales",
        order: 1,
      },
    ],
    interaction: {
      scopes: ["talks-to-customers"],
      labels: ["Talks to customers"],
    },
    availability: {
      state: "available",
      label: "Available for your business type",
      reason: "Explicit support",
      matchLevel: "leaf",
      evidence: [],
    },
    authority: {
      state: "resolved",
      scope: { kind: "default-posture" },
      level: "approval-required",
      label: "Acts with approval",
      summary: "This coworker acts after a person approves.",
      ownerReason: "Approval is required.",
      ownerAction: "Approve the action before it runs.",
      winner: {
        source: "agent",
        ref: "customer-advisor",
        field: "hitlTierDefault",
        role: "selected-base",
        observedValue: "1",
        normalizedLevel: "approval-required",
        detail: "Agent has HITL tier 1",
      },
      evidence: [],
    },
    familyKey: null,
    familyLabel: null,
    coveragePct: null,
    jurisdictions: [],
    competencies: [],
    profileBound: false,
    emptyCorpus: true,
    providerHealthy: true,
    openBlockers: 0,
    deferRate: 0,
    unmapped: true,
    lastActiveAt: null,
    ...over,
  };
}

describe("RosterView", () => {
  it("orders areas customer-first and exposes work entry only when available", () => {
    const events: CustomEvent[] = [];
    const handler = (event: Event) => events.push(event as CustomEvent);
    document.addEventListener("open-agent-panel", handler);

    render(
      <RosterView
        rows={[
          row({
            agentId: "platform-engineer",
            displayName: "Platform Engineer",
            area: {
              key: "foundational",
              label: "Platform and back office",
              order: 4,
            },
            availability: {
              state: "not-available",
              label: "Not available for your business type",
              reason: "No matching declaration",
              matchLevel: null,
              evidence: [],
            },
            canStartConversation: false,
          }),
          row(),
        ]}
        facets={facets}
      />,
    );

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings[0]?.textContent).toBe("Customers and sales");
    expect(headings[1]?.textContent).toBe("Platform and back office");
    expect(
      screen.getAllByRole("button", { name: "Ask this coworker" }),
    ).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Ask this coworker" }),
    );
    document.removeEventListener("open-agent-panel", handler);
    expect(events[0]?.detail).toEqual({
      routeContext: "/platform/ai/agent/customer-advisor",
    });
  });

  it("preserves owner filter state in the URL and coworker return link", () => {
    window.history.replaceState(
      {},
      "",
      "/platform/ai/overview?tab=coworkers",
    );
    render(
      <RosterView
        rows={[row()]}
        facets={facets}
        initialQuery="tab=coworkers"
      />,
    );

    fireEvent.change(screen.getByLabelText("Interaction"), {
      target: { value: "talks-to-customers" },
    });

    expect(window.location.search).toContain(
      "interaction=talks-to-customers",
    );
    expect(window.location.search).toContain("tab=coworkers");
    expect(
      screen.getByRole("link", { name: /View coworker/ }).getAttribute("href"),
    ).toContain("returnTo=");
  });
});

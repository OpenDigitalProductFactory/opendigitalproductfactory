// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
    agentId: "marketing-specialist",
    slugId: "marketing-specialist",
    name: "Marketing Specialist",
    displayName: "Marketing Specialist",
    kind: "specialist",
    tier: 2,
    valueStream: "consume",
    lifecycleStage: "production",
    plainJob: "Plans and runs measured marketing campaigns.",
    workSearchText: "Campaign planning Campaign measurement",
    canStartConversation: true,
    primaryService: {
      serviceId: "svc-marketing-campaign-execution",
      name: "Marketing campaign execution",
    },
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
      scopes: ["internal-only"],
      labels: ["Internal only"],
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
        ref: "marketing-specialist",
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
    openBlockers: 0,
    deferRate: 0,
    unmapped: true,
    lastActiveAt: null,
    ...over,
  };
}

describe("RosterView", () => {
  it("shows a compact first page of the directory without hiding the roster", () => {
    const rows = Array.from({ length: 13 }, (_, index) =>
      row({
        agentId: `coworker-${index + 1}`,
        displayName: `Coworker ${String(index + 1).padStart(2, "0")}`,
        plainJob: `Detailed work description ${index + 1}`,
      }),
    );

    render(
      <RosterView rows={rows} facets={facets} presentation="directory" />,
    );

    expect(screen.getByRole("searchbox", { name: "Find a coworker" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Coworker 01" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Coworker 13" })).toBeNull();
    expect(screen.queryByText("Detailed work description 1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show 1 more" }));

    expect(screen.getByRole("link", { name: "Coworker 13" })).toBeTruthy();
  });

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
    expect(screen.getAllByRole("button", { name: "Ask Marketing Specialist" })).toHaveLength(1);
    expect(
      screen.queryAllByText("Ready work: Marketing campaign execution"),
    ).toHaveLength(0);
    expect(
      screen.getAllByText("Plans and runs measured marketing campaigns."),
    ).toHaveLength(2);
    expect(
      screen
        .getByRole("button", { name: "Ask Marketing Specialist" })
        .getAttribute("class"),
    ).toContain("bg-[var(--dpf-accent)]");
    const marketingCard = document.querySelector(
      '[data-coworker-card="marketing-specialist"]',
    );
    expect(marketingCard).not.toBeNull();
    expect(
      within(marketingCard as HTMLElement).getByRole("group", {
        name: "Work includes",
      }),
    ).toBeTruthy();
    expect(
      within(marketingCard as HTMLElement).queryByText("Work includes"),
    ).toBeNull();
    expect(
      within(marketingCard as HTMLElement)
        .getByRole("link", { name: /View coworker/ })
        .getAttribute("class"),
    ).not.toContain("bg-[var(--dpf-accent)]");

    fireEvent.click(
      screen.getByRole("button", { name: "Ask Marketing Specialist" }),
    );
    document.removeEventListener("open-agent-panel", handler);
    expect(events[0]?.detail).toEqual({
      // EP-COWORKER-IDENTITY-360: Ask context is the coworker's identity route.
      routeContext: "/workforce/marketing-specialist",
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
      target: { value: "internal-only" },
    });

    expect(window.location.search).toContain(
      "interaction=internal-only",
    );
    expect(window.location.search).toContain("tab=coworkers");
    expect(
      screen.getByRole("link", { name: /View coworker/ }).getAttribute("href"),
    ).toContain("returnTo=");
  });

  it("progressively discloses secondary filters without duplicating controls", () => {
    render(<RosterView rows={[row()]} facets={facets} />);

    const filtersButton = screen.getByRole("button", { name: "Filters" });
    const filterRegion = document.getElementById("coworker-secondary-filters");
    expect(filtersButton.getAttribute("aria-expanded")).toBe("false");
    expect(filtersButton.getAttribute("aria-controls")).toBe(
      "coworker-core-filters coworker-secondary-filters",
    );
    expect(filterRegion?.classList.contains("hidden")).toBe(true);
    expect(screen.getAllByLabelText("Interaction")).toHaveLength(1);

    fireEvent.click(filtersButton);

    expect(filtersButton.getAttribute("aria-expanded")).toBe("true");
    expect(filterRegion?.classList.contains("hidden")).toBe(false);
  });

  it("shows one availability warning and an honest recovery path", () => {
    const { rerender } = render(
      <RosterView
        rows={[
          row({
            agentId: "customer-advisor",
            slugId: "customer-advisor",
            name: "Customer Advisor",
            displayName: "Customer Advisor",
            kind: "advisor",
            interaction: {
              scopes: ["talks-to-customers"],
              labels: ["Talks to customers"],
            },
            availability: {
              state: "coverage-not-defined",
              label: "Coverage not defined",
              reason: "No storefront business type is configured.",
              matchLevel: null,
              evidence: [],
              recovery: {
                kind: "business-type",
                label: "Review business type",
              },
            },
            canStartConversation: false,
          }),
        ]}
        facets={facets}
        grantedCapabilities={["view_storefront"]}
      />,
    );

    const card = document.querySelector("[data-coworker-card]");
    expect(card).not.toBeNull();
    const cardView = within(card as HTMLElement);
    expect(cardView.getAllByText("Coverage not defined")).toHaveLength(1);
    expect(cardView.queryByText("Needs attention")).toBeNull();
    expect(
      cardView
        .getByRole("link", { name: "Review business type" })
        .getAttribute("href"),
    ).toBe("/storefront/settings/business");

    rerender(
      <RosterView
        rows={[
          row({
            availability: {
              state: "coverage-not-defined",
              label: "Coverage not defined",
              reason: "No storefront business type is configured.",
              matchLevel: null,
              evidence: [],
              recovery: {
                kind: "business-type",
                label: "Review business type",
              },
            },
            canStartConversation: false,
          }),
        ]}
        facets={facets}
        grantedCapabilities={[]}
      />,
    );
    expect(
      screen.queryByRole("link", { name: "Review business type" }),
    ).toBeNull();
  });

  it("keeps setup recovery in the coworker record and preserves roster context", () => {
    window.history.replaceState(
      {},
      "",
      "/platform/ai/overview?tab=coworkers&interaction=talks-to-customers",
    );
    const { rerender } = render(
      <RosterView
        rows={[
          row({
            agentId: "customer-advisor",
            slugId: "customer-advisor",
            name: "Customer Advisor",
            displayName: "Customer Advisor",
            kind: "advisor",
            interaction: {
              scopes: ["talks-to-customers"],
              labels: ["Talks to customers"],
            },
            availability: {
              state: "setup-needed",
              label: "Setup needed",
              reason: "Assign the advertised skills.",
              matchLevel: "leaf",
              evidence: [],
              recovery: {
                kind: "capabilities",
                label: "Review capabilities",
              },
            },
            canStartConversation: false,
          }),
        ]}
        facets={facets}
        initialQuery="tab=coworkers&interaction=talks-to-customers"
        grantedCapabilities={["manage_platform"]}
      />,
    );

    const href = screen
      .getByRole("link", { name: "Review capabilities" })
      .getAttribute("href");
    expect(
      screen.queryByRole("button", { name: "Ask Customer Advisor" }),
    ).toBeNull();
    expect(href).toContain("/platform/ai/agent/customer-advisor?");
    expect(href).toContain("returnTo=");
    expect(href?.endsWith("#capabilities")).toBe(true);

    rerender(
      <RosterView
        rows={[
          row({
            availability: {
              state: "setup-needed",
              label: "Setup needed",
              reason: "Assign the advertised skills.",
              matchLevel: "leaf",
              evidence: [],
              recovery: {
                kind: "capabilities",
                label: "Review capabilities",
              },
            },
            canStartConversation: false,
          }),
        ]}
        facets={facets}
        initialQuery="tab=coworkers&interaction=talks-to-customers"
        grantedCapabilities={["view_platform"]}
      />,
    );
    expect(
      screen.queryByRole("link", { name: "Review capabilities" }),
    ).toBeNull();
  });
});

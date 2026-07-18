import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/proactivity", () => ({
  saveCoworkerProactivityPreference: vi.fn(),
}));

import { ProactivityRosterList } from "./ProactivityRosterList";
import type { ProactivityRosterRow } from "@/lib/proactivity/proactivity-roster";

const CUSTOMERS = { key: "products_and_services_sold", label: "Customers and sales", order: 1 };
const PLATFORM = { key: "foundational", label: "Platform and back office", order: 4 };

const rows: ProactivityRosterRow[] = [
  {
    agentId: "coo",
    displayName: "Chief Operating Officer",
    role: "orchestrator",
    level: "balanced",
    isOverride: false,
    explanation: "Derived from the business risk posture.",
    area: PLATFORM,
  },
  {
    agentId: "bookkeeper",
    displayName: "Bookkeeper",
    role: "analyst",
    level: "assertive",
    isOverride: true,
    explanation: "Owner override.",
    area: CUSTOMERS,
  },
];

describe("ProactivityRosterList", () => {
  it("labels a derived default and an owner override distinctly", () => {
    const html = renderToStaticMarkup(<ProactivityRosterList rows={rows} />);
    expect(html).toContain("Chief Operating Officer");
    expect(html).toContain("From your industry");
    expect(html).toContain("Bookkeeper");
    expect(html).toContain("You set this");
  });

  it("renders the coworkers grouped under their business-area headings", () => {
    const html = renderToStaticMarkup(<ProactivityRosterList rows={rows} />);
    expect(html).toContain("Customers and sales");
    expect(html).toContain("Platform and back office");
  });

  it("shows an empty message when there are no coworkers", () => {
    const html = renderToStaticMarkup(<ProactivityRosterList rows={[]} />);
    expect(html).toContain("No coworkers to configure yet.");
  });
});

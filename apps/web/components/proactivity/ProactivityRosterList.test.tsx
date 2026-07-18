import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/proactivity", () => ({
  saveCoworkerProactivityPreference: vi.fn(),
}));

import { ProactivityRosterList } from "./ProactivityRosterList";
import type { ProactivityRosterRow } from "@/lib/proactivity/proactivity-roster";

const rows: ProactivityRosterRow[] = [
  {
    agentId: "coo",
    displayName: "Chief Operating Officer",
    role: "orchestrator",
    level: "balanced",
    isOverride: false,
    explanation: "Derived from the business risk posture.",
  },
  {
    agentId: "bookkeeper",
    displayName: "Bookkeeper",
    role: "analyst",
    level: "assertive",
    isOverride: true,
    explanation: "Owner override.",
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

  it("shows an empty message when there are no coworkers", () => {
    const html = renderToStaticMarkup(<ProactivityRosterList rows={[]} />);
    expect(html).toContain("No coworkers to configure yet.");
  });
});

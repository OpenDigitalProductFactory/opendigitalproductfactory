import { describe, expect, it } from "vitest";
import { composeOpeningBriefing, surfacePrefixFromRouteContext } from "./opening-briefing";
import type { AttentionItem } from "@/lib/attention/types";

function makeItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: "approval-outbound:draft-1",
    source: "approval-outbound",
    title: "Launch email awaits your approval",
    context: "Outbound draft pending review before it can send",
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "policy-approval",
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: "2026-07-09T12:00:00.000Z",
    actions: [{ kind: "open-in-context", label: "Open", href: "/customer/marketing" }],
    deepLink: "/customer/marketing",
    audience: { operator: true },
    ...overrides,
  };
}

describe("surfacePrefixFromRouteContext", () => {
  it("keeps the first two segments and drops build fragments", () => {
    expect(surfacePrefixFromRouteContext("/customer/marketing/campaigns")).toBe("/customer/marketing");
    expect(surfacePrefixFromRouteContext("/build#FB-123")).toBe("/build");
    expect(surfacePrefixFromRouteContext("/workspace")).toBe("/workspace");
    expect(surfacePrefixFromRouteContext("/")).toBe("/");
  });
});

describe("composeOpeningBriefing", () => {
  it("stays silent on quiet — that is what quiet means", () => {
    expect(
      composeOpeningBriefing({
        routeContext: "/customer/marketing",
        proactivityLevel: "quiet",
        items: [makeItem()],
      }),
    ).toBeNull();
  });

  it("balanced speaks only when something needs the human", () => {
    expect(
      composeOpeningBriefing({
        routeContext: "/customer/marketing",
        proactivityLevel: "balanced",
        items: [],
      }),
    ).toBeNull();

    const briefing = composeOpeningBriefing({
      routeContext: "/customer/marketing",
      proactivityLevel: "balanced",
      items: [makeItem()],
    });
    expect(briefing?.content).toContain("**Most pressing:**");
    expect(briefing?.content).toContain("[Launch email awaits your approval](/customer/marketing)");
    expect(briefing?.itemCount).toBe(1);
  });

  it("assertive is always present — even the all-clear is said out loud", () => {
    const briefing = composeOpeningBriefing({
      routeContext: "/workspace",
      proactivityLevel: "assertive",
      items: [],
    });
    expect(briefing?.content).toContain("Nothing is waiting on you");
    expect(briefing?.itemCount).toBe(0);
  });

  it("defaults a missing preference to balanced", () => {
    expect(
      composeOpeningBriefing({ routeContext: "/workspace", proactivityLevel: null, items: [] }),
    ).toBeNull();
    expect(
      composeOpeningBriefing({
        routeContext: "/workspace",
        proactivityLevel: null,
        items: [makeItem()],
      }),
    ).not.toBeNull();
  });

  it("headlines the surface-local item over a globally higher-ranked one", () => {
    const globalTop = makeItem({
      id: "escalation:PIR-1",
      source: "escalation",
      title: "Build stalled",
      deepLink: "/build",
    });
    const local = makeItem();
    const briefing = composeOpeningBriefing({
      routeContext: "/customer/marketing",
      proactivityLevel: "balanced",
      items: [globalTop, local],
    });
    expect(briefing?.content).toContain("Launch email awaits your approval");
    expect(briefing?.content).toContain("1 more item is waiting for your review");
    expect(briefing?.content).toContain("[open your Needs-you inbox](/workspace/inbox)");
  });

  it("falls back to the triage-top item when nothing is surface-local", () => {
    const briefing = composeOpeningBriefing({
      routeContext: "/finance",
      proactivityLevel: "balanced",
      items: [
        makeItem({ id: "a", title: "First by triage" }),
        makeItem({ id: "b", title: "Second by triage" }),
        makeItem({ id: "c", title: "Third by triage" }),
      ],
    });
    expect(briefing?.content).toContain("First by triage");
    expect(briefing?.content).toContain("2 more items are waiting for your review");
  });
});

import { describe, expect, it } from "vitest";
import { composeOpeningBriefing, detailRestatesTitle, surfacePrefixFromRouteContext } from "./opening-briefing";
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

describe("detailRestatesTitle", () => {
  it("treats a detail that only restates the headline as redundant", () => {
    // The exact BI-49C4EA5D case: title vs a synonymous detail.
    expect(detailRestatesTitle("The knowledge graph is down", "The knowledge graph is unavailable.")).toBe(true);
    expect(detailRestatesTitle("AI memory search is down", "AI memory search is offline")).toBe(true);
  });

  it("keeps a detail that names a real downstream consequence", () => {
    expect(
      detailRestatesTitle(
        "The platform database is down",
        "The platform database is unreachable — most features will fail.",
      ),
    ).toBe(false);
    expect(detailRestatesTitle("Voice input is unavailable", "Dictation won't work until it's back.")).toBe(false);
  });

  it("treats empty or whitespace context as redundant (nothing to add)", () => {
    expect(detailRestatesTitle("Anything", "")).toBe(true);
    expect(detailRestatesTitle("Anything", "   ")).toBe(true);
    expect(detailRestatesTitle("Anything", null)).toBe(true);
  });
});

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

  it("omits a redundant detail so the headline doesn't restate itself (BI-49C4EA5D)", () => {
    const briefing = composeOpeningBriefing({
      routeContext: "/workspace",
      proactivityLevel: "balanced",
      items: [
        makeItem({
          id: "platform-health:graph",
          source: "platform-health",
          title: "The knowledge graph is down",
          context: "The knowledge graph is unavailable.",
          deepLink: "/platform/health",
        }),
      ],
    });
    expect(briefing?.content).toContain("[The knowledge graph is down](/platform/health)");
    // The em-dash-joined restatement must NOT appear.
    expect(briefing?.content).not.toContain("— The knowledge graph is unavailable");
  });

  it("keeps a detail that adds a real consequence", () => {
    const briefing = composeOpeningBriefing({
      routeContext: "/workspace",
      proactivityLevel: "balanced",
      items: [
        makeItem({
          id: "platform-health:postgres",
          source: "platform-health",
          title: "The platform database is down",
          context: "The platform database is unreachable — most features will fail.",
          deepLink: "/platform/health",
        }),
      ],
    });
    expect(briefing?.content).toContain("— The platform database is unreachable — most features will fail.");
  });

  it("falls back to the triage-top item when nothing is surface-local", () => {
    const briefing = composeOpeningBriefing({
      routeContext: "/workspace",
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

describe("Finance contextual opening research (BI-9F118032)", () => {
  const routine = () => makeItem({ title: "Technical release question", deepLink: "/build" });
  const finance = () => makeItem({ id: "finance", title: "Check supplier discrepancy", deepLink: "/finance/bills" });
  const compose = (items: AttentionItem[], routeContext = "/finance/spend") =>
    composeOpeningBriefing({ items, routeContext, proactivityLevel: "balanced" });

  it.each([1, 3])("keeps all %i routine global decisions counted without a technical headline", (count) => {
    const result = compose(Array.from({ length: count }, (_, i) => ({ ...routine(), id: `global-${i}` })));
    expect(result?.content).not.toContain("Technical release question");
    expect(result?.content).toContain("/finance/my-expenses/new");
    expect(result?.content).toContain("positive amount");
    expect(result?.content).toContain("receipt URL");
    expect(result?.content).toContain(`${count} owner ${count === 1 ? "decision is" : "decisions are"}`);
    expect(result?.content).toContain("/workspace/inbox");
    expect(result?.itemCount).toBe(count);
  });

  it("prefers relevant Finance work and counts the remaining owner decisions", () => {
    const result = compose([routine(), finance()]);
    expect(result?.content).toContain("[Check supplier discrepancy](/finance/bills)");
    expect(result?.content).not.toContain("Technical release question");
    expect(result?.content).toContain("1 more item is waiting for your review");
    expect(result?.itemCount).toBe(2);
  });

  it.each(["overdue", "due-today"] as const)("keeps a global %s decision ahead of routine local Finance work", (timeToAct) => {
    const urgent = routine();
    urgent.triage = { ...urgent.triage, timeToAct };
    const result = compose([urgent, { ...finance(), deepLink: "/finance/spend/ai" }]);
    expect(result?.content).toContain("[Technical release question](/build)");
    expect(result?.content).toContain(timeToAct === "overdue" ? "deadline passed" : "deadline today");
    expect(result?.content).toContain("/finance/my-expenses/new");
    expect(result?.itemCount).toBe(2);
  });

  it("keeps irreversible high-risk global decisions visible and preserves their input order", () => {
    const urgent = { ...routine(), riskClass: "high-risk" as const };
    urgent.triage = { ...urgent.triage, irreversible: true };
    const later = { ...urgent, id: "later", title: "Later urgent item" };
    const result = compose([urgent, later, { ...finance(), deepLink: "/finance/spend/ai" }]);
    expect(result?.content).toContain("[Technical release question](/build)");
    expect(result?.content).toContain("irreversible, high-risk");
    expect(result?.content).not.toContain("Later urgent item");
    expect(result?.content).toContain("2 more items");
    expect(result?.itemCount).toBe(3);
  });

  it("normalizes Finance query/fragment and prefers the current Finance surface", () => {
    const local = { ...finance(), id: "local", title: "Current Spend decision", deepLink: "/finance/spend/ai" };
    expect(compose([finance(), local], "/finance/spend?view=all#details")?.content).toContain("Current Spend decision");
  });

  it("does not mistake Finance-like item prefixes for relevant Finance work", () => {
    const other = { ...routine(), deepLink: "/finance-other" };
    expect(compose([other], "/finance")?.content).not.toContain("Technical release question");
    expect(compose([other], "/finance")?.content).not.toContain("positive amount");
  });

  it("keeps non-expense Finance help general and non-Finance behavior unchanged", () => {
    const general = compose([routine()], "/finance/reports/general-ledger");
    expect(general?.content).toContain("finance task");
    expect(general?.content).not.toContain("/finance/my-expenses/new");
    expect(compose([routine()], "/finance-other")?.content).toContain("Technical release question");
  });

  it.each(["/finance/spend/ai", "/finance/my-expenses-other", "/finance/expense-claims-other"])("does not prescribe expense entry for %s", (routeContext) => {
    expect(compose([routine()], routeContext)?.content).not.toContain("/finance/my-expenses/new");
  });

  it("does not create an urgent override for reversible high-risk routine work", () => {
    const global = { ...routine(), riskClass: "high-risk" as const };
    expect(compose([global, finance()])?.content).toContain("Check supplier discrepancy");
    expect(compose([global, finance()])?.content).not.toContain("Technical release question");
  });

  it.each(["/finance/spend", "/finance/expense-claims", "/finance/my-expenses/new"])("preserves balanced zero-owner silence on %s", (routeContext) => {
    expect(compose([], routeContext)).toBeNull();
    expect(composeOpeningBriefing({ items: [routine()], routeContext, proactivityLevel: "quiet" })).toBeNull();
  });
});

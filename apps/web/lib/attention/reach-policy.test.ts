import { describe, expect, it } from "vitest";

import { planReach, reachUrgency } from "./reach-policy";
import type { AttentionItem, AttentionSource } from "./types";
import type { CommunicationBindingSummary } from "@/lib/communications/dispatch-policy";

const NOW = new Date("2026-08-01T12:00:00.000Z");

const ALL_CHANNELS: CommunicationBindingSummary[] = [
  { channel: "in-app", verified: true, active: true, allowedUrgencies: ["routine", "priority", "urgent", "emergency"] },
  { channel: "email", verified: true, active: true, allowedUrgencies: ["routine", "priority", "urgent", "emergency"] },
  { channel: "push", verified: true, active: true, allowedUrgencies: ["routine", "priority", "urgent", "emergency"] },
];

function item(source: AttentionSource, overrides: Partial<AttentionItem["triage"]> = {}): AttentionItem {
  return {
    id: `${source}:1`,
    source,
    title: "Something needs you",
    context: "why now",
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "no-self-heal",
      decideEffort: "review",
      irreversible: false,
      ...overrides,
    },
    createdAtIso: NOW.toISOString(),
    actions: [],
    deepLink: "/workspace",
    audience: { operator: true },
  };
}

/** Every source the attention surface can project. If a new source is added without a
 *  reach decision, this list is where the omission shows up. */
const ALL_SOURCES: AttentionSource[] = [
  "escalation",
  "ai-decision",
  "paused-ai",
  "scheduled-task",
  "agent-proposal",
  "approval-outbound",
  "approval-bill",
  "approval-expense",
  "compliance-submission",
  "research-proposal",
  "coworker-memory",
  "ai-readiness-blocker",
  "platform-health",
  "provider-credential",
  "reservation-exception",
  "storefront-inquiry",
  "hospitality-capacity",
  "business-journey",
];

describe("no message can ever act on a hard-floored item", () => {
  // This is THE acceptance criterion. The kernel scored the one-click option NEGATIVE on
  // "Outbound and irreversible actions require explicit go"; this test is what keeps that
  // decision true as the code changes around it.
  it.each(["approval-bill", "approval-expense", "approval-outbound", "compliance-submission"] as const)(
    "%s is never one-click eligible",
    (source) => {
      const decision = planReach({ item: item(source), bindings: ALL_CHANNELS, now: NOW });
      expect(decision.lane.hardFloor).toBe(true);
      expect(decision.oneClickEligible).toBe(false);
    },
  );

  it("never marks an irreversible item eligible, even without a hard floor", () => {
    const decision = planReach({
      item: item("agent-proposal", { irreversible: true }),
      bindings: ALL_CHANNELS,
      now: NOW,
    });
    expect(decision.lane.hardFloor).toBe(false);
    expect(decision.oneClickEligible).toBe(false);
  });

  it("classifies every known source without throwing", () => {
    for (const source of ALL_SOURCES) {
      expect(() => planReach({ item: item(source), bindings: ALL_CHANNELS, now: NOW })).not.toThrow();
    }
  });
});

describe("who does not get interrupted off-site", () => {
  it.each(["platform-health", "escalation", "provider-credential", "ai-readiness-blocker", "scheduled-task"] as const)(
    "%s is custodian work and earns no off-site message",
    (source) => {
      const decision = planReach({ item: item(source), bindings: ALL_CHANNELS, now: NOW });
      expect(decision.lane.lane).toBe("custodian");
      expect(decision.reachable).toBe(false);
      expect(decision.channels).toEqual([]);
    },
  );

  it("does not send an individual message for a digest item", () => {
    const decision = planReach({ item: item("coworker-memory"), bindings: ALL_CHANNELS, now: NOW });
    expect(decision.lane.lane).toBe("weekly-digest");
    expect(decision.reachable).toBe(false);
  });
});

describe("who does get reached", () => {
  it("reaches the owner for money leaving the business", () => {
    const decision = planReach({ item: item("approval-bill"), bindings: ALL_CHANNELS, now: NOW });
    expect(decision.reachable).toBe(true);
    expect(decision.channels).toContain("email");
    expect(decision.reason).toMatch(/money/i);
  });

  it("reaches the owner for a customer waiting on a reply", () => {
    const decision = planReach({ item: item("storefront-inquiry"), bindings: ALL_CHANNELS, now: NOW });
    expect(decision.reachable).toBe(true);
    expect(decision.channels).toContain("email");
  });

  it("is unreachable when the owner has bound no channel", () => {
    const decision = planReach({ item: item("approval-bill"), bindings: [], now: NOW });
    expect(decision.reachable).toBe(false);
    expect(decision.channels).toEqual([]);
  });

  it("does not reach on an unverified binding", () => {
    const decision = planReach({
      item: item("approval-bill"),
      bindings: [{ channel: "email", verified: false, active: true, allowedUrgencies: ["priority"] }],
      now: NOW,
    });
    expect(decision.reachable).toBe(false);
  });
});

describe("reachUrgency", () => {
  it("raises a hard-floored item above routine even with no deadline", () => {
    expect(reachUrgency(item("approval-bill"), true)).toBe("priority");
  });

  it("treats overdue as urgent regardless of floor", () => {
    expect(reachUrgency(item("ai-decision", { timeToAct: "overdue" }), false)).toBe("urgent");
  });

  it("treats irreversible money work as urgent", () => {
    expect(reachUrgency(item("approval-bill", { irreversible: true }), true)).toBe("urgent");
  });

  it("leaves an ordinary reversible item routine", () => {
    expect(reachUrgency(item("ai-decision"), false)).toBe("routine");
  });
});

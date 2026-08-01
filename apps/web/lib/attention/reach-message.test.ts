import { describe, expect, it } from "vitest";

import { composeReachMessage, outcomeClassFor } from "./reach-message";
import type { ReachDecision } from "./reach-policy";
import type { AttentionSource } from "./types";

const LINK = "https://example.test/r/abc.def";

function decision(overrides: Partial<ReachDecision> = {}): ReachDecision {
  return {
    reachable: true,
    channels: ["email"],
    urgency: "priority",
    oneClickEligible: false,
    reason: "Money would leave the business.",
    lane: {
      lane: "needs-you-now",
      reason: "Money would leave the business.",
      hardFloor: true,
      appliedLevel: "balanced",
    },
    ...overrides,
  };
}

describe("the message carries no business content", () => {
  // OWASP "Lies in the Loop": if the operator reads WHAT to approve inside the email, the
  // email becomes the place they can be lied to. The composer is never handed the item's
  // title, context, or blast radius — this test pins that.
  it("takes no parameter that could carry item content", () => {
    const message = composeReachMessage({
      source: "approval-bill",
      decision: decision(),
      linkUrl: LINK,
    });

    // Nothing from a bill: no supplier, no amount, no reference.
    expect(message.textBody).not.toMatch(/\$|£|€|\d{3,}/);
    expect(message.subject).toBe("A bill needs your approval");
  });

  it("says only the outcome class, the urgency, and the link", () => {
    const message = composeReachMessage({
      source: "storefront-inquiry",
      decision: decision({ urgency: "urgent", oneClickEligible: true }),
      linkUrl: LINK,
    });

    expect(message.textBody).toContain("A customer is waiting for a reply.");
    expect(message.textBody).toContain(LINK);
    expect(message.textBody).toContain("This is overdue.");
  });

  it("prefixes the business name when the install has one", () => {
    const message = composeReachMessage({
      source: "approval-bill",
      decision: decision(),
      linkUrl: LINK,
      businessName: "Dale's Plumbing",
    });
    expect(message.subject).toBe("Dale's Plumbing: A bill needs your approval");
  });
});

describe("the message never promises an action it cannot deliver", () => {
  it("tells a hard-floored recipient plainly that email cannot approve it", () => {
    const message = composeReachMessage({
      source: "approval-bill",
      decision: decision({ oneClickEligible: false }),
      linkUrl: LINK,
    });
    expect(message.textBody).toContain("cannot be approved from an email");
  });

  it("still requires sign-in even for an eligible class, because P1 ships no one-click", () => {
    const message = composeReachMessage({
      source: "ai-decision",
      decision: decision({ oneClickEligible: true, lane: { ...decision().lane, hardFloor: false } }),
      linkUrl: LINK,
    });
    expect(message.textBody).toContain("sign in to decide");
    // No approve/reject verbs — an operator must not expect a one-tap that does not exist.
    expect(message.textBody).not.toMatch(/\bapprove now\b|\btap to approve\b|\breject\b/i);
  });
});

describe("outcomeClassFor", () => {
  const SOURCES: AttentionSource[] = [
    "approval-bill",
    "approval-expense",
    "approval-outbound",
    "compliance-submission",
    "reservation-exception",
    "storefront-inquiry",
    "hospitality-capacity",
    "business-journey",
    "ai-decision",
    "agent-proposal",
    "paused-ai",
    "research-proposal",
    "coworker-memory",
    "escalation",
    "scheduled-task",
    "ai-readiness-blocker",
    "platform-health",
    "provider-credential",
  ];

  it("has owner-language copy for every source, with no platform jargon", () => {
    // Targets the platform's internal vocabulary, not ordinary English. "needs attention"
    // is fine for an owner to read; "attention item" and "residue" are not.
    const JARGON =
      /residue|projection|adapter|dispatch|payload|backlog item|attention (item|surface)|hard floor|coworker turn/i;
    for (const source of SOURCES) {
      const copy = outcomeClassFor(source);
      expect(copy.length).toBeGreaterThan(0);
      expect(copy).not.toMatch(JARGON);
    }
  });

  it("phrases every outcome as something the business lost or needs, not a system state", () => {
    for (const source of SOURCES) {
      // Each reads as a sentence about the owner's world. Guards against a future entry
      // being written as "TaskRun stalled" or similar.
      expect(outcomeClassFor(source)).toMatch(/^(A|An|Your|Something|A coworker)\b/);
    }
  });
});

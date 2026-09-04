import { describe, expect, it } from "vitest";

import { classifyOwnerAttentionLane } from "./owner-routing";
import type { AttentionItem, AttentionSource } from "./types";
import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";

function item(
  source: AttentionSource,
  over: Partial<AttentionItem> = {},
): AttentionItem {
  return {
    id: `${source}:1`,
    source,
    title: source,
    context: "context",
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "policy-approval",
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: "2026-07-17T12:00:00.000Z",
    actions: [],
    deepLink: "/x",
    audience: { operator: true },
    ...over,
  };
}

describe("classifyOwnerAttentionLane", () => {
  it.each<AttentionSource>([
    "approval-bill",
    "approval-expense",
    "approval-outbound",
    "compliance-submission",
  ])("keeps money-out and public hard floors in needs-you at every dial level: %s", (source) => {
    const levels: ProactivityLevel[] = ["quiet", "balanced", "assertive"];
    for (const level of levels) {
      expect(classifyOwnerAttentionLane(item(source), level)).toMatchObject({
        lane: "needs-you-now",
        hardFloor: true,
      });
    }
  });

  it.each<AttentionSource>([
    "platform-health",
    "ai-readiness-blocker",
    "escalation",
    "provider-credential",
  ])("routes platform plumbing to the custodian lane: %s", (source) => {
    const decision = classifyOwnerAttentionLane(
      item(source, {
        title: "qdrant is offline",
        riskClass: "high-risk",
        triage: {
          timeToAct: "none",
          residueReason: "no-self-heal",
          blastRadius: "sandbox",
          decideEffort: "review",
          irreversible: false,
        },
      }),
      "quiet",
    );

    expect(decision.lane).toBe("custodian");
    expect(decision.reason).toMatch(/technical|platform|custodian/i);
  });

  it("keeps real human judgment in needs-you even when assertive", () => {
    expect(
      classifyOwnerAttentionLane(
        item("ai-decision", {
          triage: {
            timeToAct: "none",
            residueReason: "principle-conflict",
            decideEffort: "judgment",
            irreversible: false,
          },
        }),
        "assertive",
      ).lane,
    ).toBe("needs-you-now");
  });

  it("routes low-urgency research by the proactivity dial", () => {
    const research = item("research-proposal", { riskClass: "read" });

    expect(classifyOwnerAttentionLane(research, "quiet").lane).toBe("needs-you-now");
    expect(classifyOwnerAttentionLane(research, "balanced").lane).toBe("weekly-digest");
    expect(classifyOwnerAttentionLane(research, "assertive").lane).toBe("weekly-digest");
  });

  it("routes newly acquired coworker memories to the digest", () => {
    expect(classifyOwnerAttentionLane(item("coworker-memory", { riskClass: "read" })).lane)
      .toBe("weekly-digest");
  });

  it("routes missing credentials to the custodian instead of pretending they need judgment", () => {
    const paused = item("paused-ai", {
      triage: {
        timeToAct: "none",
        residueReason: "needs-credential",
        decideEffort: "review",
        irreversible: false,
      },
    });

    expect(classifyOwnerAttentionLane(paused, "balanced").lane).toBe("custodian");
  });

  it("demotes generic corpus-fallback decisions (coverage-gap, nothing blocked) to the digest", () => {
    const generic = item("ai-decision", {
      triage: {
        timeToAct: "none",
        residueReason: "coverage-gap",
        decideEffort: "judgment",
        irreversible: false,
      },
    });
    expect(classifyOwnerAttentionLane(generic, "balanced").lane).toBe("weekly-digest");
  });

  it("keeps a coverage-gap decision that blocks a concrete outcome in needs-you", () => {
    const blocking = item("ai-decision", {
      triage: {
        timeToAct: "none",
        residueReason: "coverage-gap",
        blastRadius: "build FB-123",
        decideEffort: "judgment",
        irreversible: false,
      },
    });
    expect(classifyOwnerAttentionLane(blocking, "balanced").lane).toBe("needs-you-now");
  });

  it("uses source-carried per-coworker proactivity before the fallback", () => {
    const research = item("research-proposal", {
      proactivity: { level: "quiet", actorId: "research-coworker" },
    });

    expect(classifyOwnerAttentionLane(research, "assertive")).toMatchObject({
      lane: "needs-you-now",
      appliedLevel: "quiet",
    });
  });
});

// Running Second Chance Animal Rescue for a day found 40 items in the owner's
// inbox, of which 34 were paused platform task runs — "spec-approval for
// BI-7D2C4F02", "Record the research gate for BI-2DB7254B" — and exactly ONE
// was the rescue's own business. Every one of the 34 carried the placeholder
// blast radius "a coworker task" and the platform's own advice to keep it with
// the specialist (BI-79E207B9).
describe("work the platform already knows is not the owner's", () => {
  const pausedPlatformRun = () =>
    item("paused-ai", {
      title: "spec-approval for BI-7D2C4F02 at 5f4d8aacb8fc",
      triage: {
        timeToAct: "none",
        residueReason: "input-required",
        blastRadius: "a coworker task",
        decideEffort: "judgment",
        irreversible: false,
      },
    });

  it("leaves the owner's count when nothing concrete is blocked", () => {
    expect(classifyOwnerAttentionLane(pausedPlatformRun()).lane).toBe("custodian");
  });

  it("comes back the moment the run names what it is actually holding up", () => {
    const namesIt = item("paused-ai", {
      triage: {
        timeToAct: "none",
        residueReason: "input-required",
        blastRadius: "the Vasquez adoption enquiry",
        decideEffort: "judgment",
        irreversible: false,
      },
    });

    expect(classifyOwnerAttentionLane(namesIt).lane).toBe("needs-you-now");
  });

  it("treats a blank blast radius the same as a placeholder one", () => {
    const blank = item("agent-proposal", {
      triage: {
        timeToAct: "none",
        residueReason: "input-required",
        decideEffort: "judgment",
        irreversible: false,
      },
    });

    expect(classifyOwnerAttentionLane(blank).lane).toBe("custodian");
  });

  it("never demotes a hard floor, however vague the blast radius", () => {
    const vagueTriage = {
      timeToAct: "none" as const,
      residueReason: "policy-approval" as const,
      blastRadius: "a coworker task",
      decideEffort: "review" as const,
      irreversible: false,
    };
    const hardFloors: AttentionSource[] = [
      "approval-bill",
      "approval-expense",
      "approval-outbound",
      "compliance-submission",
      "reservation-exception",
      "storefront-inquiry",
      "coworker-envelope",
    ];

    for (const source of hardFloors) {
      const decision = classifyOwnerAttentionLane(item(source, { triage: vagueTriage }));
      expect(decision.lane, `${source} was demoted`).toBe("needs-you-now");
      expect(decision.hardFloor, `${source} lost its hard floor`).toBe(true);
    }
  });
});

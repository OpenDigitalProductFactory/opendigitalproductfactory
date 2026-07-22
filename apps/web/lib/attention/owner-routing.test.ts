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

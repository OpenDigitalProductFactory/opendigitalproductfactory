import { describe, expect, it } from "vitest";

import { buildOwnerAttentionProjection } from "./owner-projection";
import type { AttentionItem, AttentionSource } from "./types";

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
    actions: [{ kind: "open-in-context", label: "Review", href: "/review" }],
    deepLink: "/review",
    audience: { operator: true },
    ...over,
  };
}

describe("buildOwnerAttentionProjection", () => {
  it("partitions every item into exactly one owner, weekly, or custodian lane", () => {
    const input = [
      item("approval-bill"),
      item("research-proposal", { id: "research-proposal:2", riskClass: "read" }),
      item("platform-health", { id: "platform-health:3" }),
    ];

    const projection = buildOwnerAttentionProjection(input, {
      fallbackLevel: "balanced",
      nowMs: Date.parse("2026-07-17T18:00:00Z"),
    });
    const allIds = [
      ...projection.needsYouNow,
      ...projection.weeklyDigest,
      ...projection.custodian,
    ].map((entry) => entry.item.id);

    expect(projection.count).toBe(1);
    expect(projection.needsYouNow.map((entry) => entry.item.source)).toEqual(["approval-bill"]);
    expect(projection.weeklyDigest.map((entry) => entry.item.source)).toEqual(["research-proposal"]);
    expect(projection.custodian.map((entry) => entry.item.source)).toEqual(["platform-health"]);
    expect(new Set(allIds).size).toBe(input.length);
  });

  it("does not promote technical blast-radius text into the owner count", () => {
    const projection = buildOwnerAttentionProjection(
      [
        item("platform-health", {
          title: "qdrant is offline",
          riskClass: "high-risk",
          triage: {
            timeToAct: "none",
            residueReason: "no-self-heal",
            blastRadius: "qdrant",
            decideEffort: "review",
            irreversible: false,
          },
        }),
      ],
      { fallbackLevel: "quiet", nowMs: Date.now() },
    );

    expect(projection.count).toBe(0);
    expect(projection.custodian).toHaveLength(1);
  });

  it("retains outside-in order within each lane", () => {
    const projection = buildOwnerAttentionProjection(
      [
        item("ai-decision", { id: "workforce" }),
        item("approval-outbound", { id: "customer" }),
      ],
      { fallbackLevel: "balanced", nowMs: Date.now() },
    );

    expect(projection.needsYouNow.map((entry) => entry.item.id)).toEqual(["customer", "workforce"]);
  });
});

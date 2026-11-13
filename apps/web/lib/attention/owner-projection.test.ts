import { describe, expect, it } from "vitest";

import { buildOwnerAttentionProjection, namedCustodianHeadlines } from "./owner-projection";
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
          title: "redis is offline",
          riskClass: "high-risk",
          triage: {
            timeToAct: "none",
            residueReason: "no-self-heal",
            blastRadius: "redis",
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

// BI-ACE041FE: the live Codex usage-limit row (reset 2026-11-17 03:54 UTC) and
// the xAI sign-in row were both hidden behind "your digital team is handling".
describe("AI-capacity items in the owner projection", () => {
  const capacity = (key: string, title: string, residueReason: AttentionItem["triage"]["residueReason"]) =>
    item("platform-health", {
      id: `platform-health:ai-capacity:${key}`,
      title,
      triage: { timeToAct: "none", residueReason, decideEffort: "review", irreversible: false },
    });

  it("puts a sign-in loss in Needs-you and names a self-resetting limit under what is being handled", () => {
    const projection = buildOwnerAttentionProjection(
      [
        capacity("provider:xai", "Sign in to xAI (Grok) again", "needs-credential"),
        capacity("provider:codex", "OpenAI Codex has hit its usage limit until 2026-11-17 03:54 UTC", "self-heals"),
        item("platform-health", { id: "platform-health:health_alert:disk", title: "Disk filling", triage: { timeToAct: "none", residueReason: "no-self-heal", decideEffort: "review", irreversible: false } }),
      ],
      { nowMs: Date.parse("2026-11-13T16:00:00.000Z") },
    );
    expect(projection.needsYouNow.map((e) => e.card.headline)).toEqual(["Sign in to xAI (Grok) again"]);
    expect(namedCustodianHeadlines(projection)).toEqual(["OpenAI Codex has hit its usage limit until 2026-11-17 03:54 UTC"]);
    expect(projection.custodian).toHaveLength(2);
  });
});

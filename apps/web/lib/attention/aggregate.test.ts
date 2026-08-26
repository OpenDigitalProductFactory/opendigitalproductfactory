import { describe, it, expect } from "vitest";
import { aggregateAttention, attentionSourceLoaders, filterAttentionForAudience } from "./aggregate";
import type { AttentionItem } from "./types";

function item(id: string, over: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id,
    source: "escalation",
    title: id,
    context: "",
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: { timeToAct: "none", residueReason: "self-fix-exhausted", decideEffort: "judgment", irreversible: false },
    createdAtIso: "2026-06-23T12:00:00.000Z",
    actions: [],
    deepLink: "/build",
    audience: { operator: true },
    ...over,
  };
}

describe("aggregateAttention", () => {
  it("collects items from every source and orders them by the tiered rule", async () => {
    const result = await aggregateAttention([
      { source: "escalation", load: async () => [item("escalation:1", { riskClass: "read" })] },
      {
        source: "paused-ai",
        load: async () => [item("paused-ai:1", { riskClass: "high-risk", triage: { timeToAct: "overdue", residueReason: "input-required", decideEffort: "judgment", irreversible: false } })],
      },
    ]);
    expect(result.failedSources).toEqual([]);
    // The overdue (override-tier) paused-ai item sorts ahead of the read escalation.
    expect(result.items.map((i) => i.id)).toEqual(["paused-ai:1", "escalation:1"]);
  });

  it("degrades a throwing source to failedSources instead of a blank inbox", async () => {
    const result = await aggregateAttention([
      { source: "escalation", load: async () => [item("escalation:1")] },
      {
        source: "ai-decision",
        load: async () => {
          throw new Error("db down");
        },
      },
    ]);
    expect(result.items.map((i) => i.id)).toEqual(["escalation:1"]);
    expect(result.failedSources).toEqual(["ai-decision"]);
  });
});

describe("filterAttentionForAudience", () => {
  const operatorOnly = item("op", { audience: { operator: true } });
  const workerOwned = item("worker", { audience: { operator: true, assigneePrincipalId: "p-7" } });
  const items = [operatorOnly, workerOwned];

  it("shows operators the full residue", () => {
    expect(filterAttentionForAudience(items, { operator: true }).map((i) => i.id)).toEqual(["op", "worker"]);
  });

  it("shows a worker only items assigned to their principal", () => {
    expect(filterAttentionForAudience(items, { operator: false, principalId: "p-7" }).map((i) => i.id)).toEqual([
      "worker",
    ]);
  });

  it("shows a worker nothing when no item is assigned to them", () => {
    expect(filterAttentionForAudience(items, { operator: false, principalId: "p-99" })).toEqual([]);
  });
});

describe("attentionSourceLoaders", () => {
  const db = {} as never;

  it("registers the coworker-envelope source for an identified reader", () => {
    const sources = attentionSourceLoaders(db, { delegatingUserId: "user-1" }).map(
      (loader) => loader.source,
    );
    expect(sources).toContain("coworker-envelope");
  });

  it("omits the coworker-envelope source when no reader is identified", () => {
    // Without a delegating user there is no safe scope for envelopes, so the
    // source is not registered at all (BI-7CB2CCDE).
    const sources = attentionSourceLoaders(db, {}).map((loader) => loader.source);
    expect(sources).not.toContain("coworker-envelope");
    expect(sources).toContain("agent-proposal");
  });
});

import { describe, expect, it } from "vitest";

import { aiCapacityToAttentionItem, selectAiCapacityItems, type OpenAiCapacityIssue } from "./ai-capacity";

const providerRow: OpenAiCapacityIssue = {
  issueKey: "ai-capacity:provider:anthropic",
  severity: "warn",
  summary: "Anthropic API has reached its spending limit",
  details: {
    kind: "provider",
    providerId: "anthropic",
    name: "Anthropic API",
    cause: "spend-limit",
    explanation: "All 12 AI requests sent to Anthropic API in the last 30 minutes failed.",
    actionLabel: "Review the provider",
    href: "/platform/ai/providers/anthropic",
    title: "Anthropic API has reached its spending limit",
  },
  firstDetectedAt: new Date("2026-10-27T11:30:00.000Z"),
};

const platformRow: OpenAiCapacityIssue = {
  issueKey: "ai-capacity:platform",
  severity: "error",
  summary: "Only 13% of AI requests are succeeding",
  details: {
    kind: "platform",
    explanation: "In the last 30 minutes 4 of 32 AI requests completed.",
    actionLabel: "Review AI providers",
    href: "/platform/ai/providers",
    title: "Only 13% of AI requests are succeeding",
  },
  firstDetectedAt: new Date("2026-10-27T11:35:00.000Z"),
};

describe("aiCapacityToAttentionItem", () => {
  it("projects the all-subscriptions-exhausted row as a high-risk item for the AI workforce (BI-5A6C4011)", () => {
    const item = aiCapacityToAttentionItem({
      issueKey: "ai-capacity:subscriptions",
      severity: "error",
      summary: "Every AI subscription is out of capacity",
      details: { kind: "subscriptions", explanation: "Codex has hit its usage limit (resets 2026-11-09 18:42 UTC).", href: "/platform/ai/providers" },
      firstDetectedAt: new Date("2026-11-06T12:15:00.000Z"),
    });
    expect(item).toMatchObject({ riskClass: "high-risk", triage: { blastRadius: "AI workforce" }, deepLink: "/platform/ai/providers" });
  });

  it("projects a provider row as one plain-language item with its exact page and action", () => {
    const item = aiCapacityToAttentionItem(providerRow);
    expect(item).toMatchObject({
      id: "platform-health:ai-capacity:provider:anthropic",
      source: "platform-health",
      title: "Anthropic API has reached its spending limit",
      deepLink: "/platform/ai/providers/anthropic",
      riskClass: "bounded-write",
      audience: { operator: true },
    });
    expect(item.actions).toEqual([
      { kind: "open-in-context", label: "Review the provider", href: "/platform/ai/providers/anthropic" },
    ]);
    expect(item.context).toContain("12 AI requests");
    expect(item.createdAtIso).toBe("2026-10-27T11:30:00.000Z");
  });

  it("marks a usage limit as recovering on its own and every other capacity loss as needing the operator (BI-ACE041FE)", () => {
    const usage = aiCapacityToAttentionItem({ ...providerRow, details: { ...(providerRow.details as object), cause: "usage-limit" } });
    expect(usage.triage.residueReason).toBe("self-heals");
    expect(aiCapacityToAttentionItem(providerRow).triage.residueReason).toBe("no-self-heal");
    const signIn = aiCapacityToAttentionItem({ ...providerRow, details: { ...(providerRow.details as object), cause: "sign-in" } });
    expect(signIn.triage.residueReason).toBe("needs-credential");
    expect(aiCapacityToAttentionItem(platformRow).triage.residueReason).toBe("no-self-heal");
  });

  it("ranks a platform collapse as high risk", () => {
    const item = aiCapacityToAttentionItem(platformRow);
    expect(item.riskClass).toBe("high-risk");
    expect(item.deepLink).toBe("/platform/ai/providers");
  });
});

describe("selectAiCapacityItems", () => {
  it("drops a sign-in row when the provider-credential lane already shows that provider", () => {
    const signIn: OpenAiCapacityIssue = {
      ...providerRow,
      issueKey: "ai-capacity:provider:anthropic-sub",
      details: { ...(providerRow.details as object), providerId: "anthropic-sub", cause: "sign-in" },
    };
    const items = selectAiCapacityItems([signIn, providerRow, platformRow], new Set(["anthropic-sub"]));
    expect(items.map((i) => i.id)).toEqual([
      "platform-health:ai-capacity:provider:anthropic",
      "platform-health:ai-capacity:platform",
    ]);
  });

  it("keeps a spend-limit row even when the credential lane names the provider", () => {
    const items = selectAiCapacityItems([providerRow], new Set(["anthropic"]));
    expect(items).toHaveLength(1);
  });
});

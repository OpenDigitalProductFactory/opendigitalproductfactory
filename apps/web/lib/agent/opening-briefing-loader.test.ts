import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AttentionItem, AttentionSource } from "@/lib/attention/types";

const mocks = vi.hoisted(() => ({
  loadAttentionItems: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/agent-routing", () => ({
  resolveAgentForRoute: vi.fn(() => ({ agentId: "AGT-COO" })),
}));
vi.mock("@/lib/feature-flags", () => ({
  isUnifiedCoworkerEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/attention/aggregate", () => ({
  loadAttentionItems: mocks.loadAttentionItems,
  filterAttentionForAudience: vi.fn((items: AttentionItem[]) => items),
}));

import { loadOpeningBriefingPayload } from "./opening-briefing-loader";

function item(source: AttentionSource, index: number): AttentionItem {
  return {
    id: `${source}:${index}`,
    source,
    title: `${source} item ${index}`,
    context: "context",
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "policy-approval",
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: "2026-09-03T12:00:00.000Z",
    actions: [{ kind: "open-in-context", label: "Open", href: "/review" }],
    deepLink: "/review",
    audience: { operator: true },
  };
}

describe("loadOpeningBriefingPayload", () => {
  beforeEach(() => {
    mocks.loadAttentionItems.mockReset();
  });

  it("stays silent when every visible item belongs to the digital team", async () => {
    mocks.loadAttentionItems.mockResolvedValue({
      items: Array.from({ length: 51 }, (_, index) => item("platform-health", index + 1)),
      failedSources: [],
    });

    await expect(loadOpeningBriefingPayload({ id: "user-1" }, "/workspace")).resolves.toBeNull();
  });

  it("counts only genuine owner decisions in the opening briefing", async () => {
    const ownerDecision = item("approval-outbound", 1);
    ownerDecision.title = "Launch email awaits your approval";
    ownerDecision.deepLink = "/customer/marketing";

    mocks.loadAttentionItems.mockResolvedValue({
      items: [
        ownerDecision,
        ...Array.from({ length: 50 }, (_, index) => item("platform-health", index + 1)),
      ],
      failedSources: [],
    });

    const result = await loadOpeningBriefingPayload({ id: "user-1" }, "/workspace");

    expect(result?.agentId).toBe("AGT-COO");
    expect(result?.content).toContain("Launch email awaits your approval");
    expect(result?.content).not.toContain("more items");
    expect(result?.content).not.toContain("platform-health item");
  });
});

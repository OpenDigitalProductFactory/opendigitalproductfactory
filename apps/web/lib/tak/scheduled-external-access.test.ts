import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAgentToolGrantsAsync } = vi.hoisted(() => ({
  mockGetAgentToolGrantsAsync: vi.fn(),
}));

vi.mock("@/lib/tak/agent-grants", () => ({
  getAgentToolGrantsAsync: mockGetAgentToolGrantsAsync,
}));

import {
  assertScheduledResearchCapability,
  resolveScheduledTurnExternalAccess,
  scheduledTaskNeedsExternalResearch,
  ScheduledResearchUnavailableError,
} from "./scheduled-external-access";

describe("resolveScheduledTurnExternalAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enables external access when the agent holds the web_search grant", async () => {
    mockGetAgentToolGrantsAsync.mockResolvedValue(["crm_read", "web_search"]);
    const result = await resolveScheduledTurnExternalAccess("customer-advisor");
    expect(result).toEqual({ enabled: true, reason: "web-search-grant" });
  });

  it("disables external access without the grant", async () => {
    mockGetAgentToolGrantsAsync.mockResolvedValue(["registry_read"]);
    const result = await resolveScheduledTurnExternalAccess("finance-controller");
    expect(result).toEqual({ enabled: false, reason: "no-web-search-grant" });
  });
});

describe("scheduledTaskNeedsExternalResearch", () => {
  it("treats the watch task kinds as research regardless of prompt", () => {
    expect(
      scheduledTaskNeedsExternalResearch({
        taskKind: "product-intelligence-watch",
        prompt: "Summarize internal notes.",
      }),
    ).toBe(true);
    expect(
      scheduledTaskNeedsExternalResearch({
        taskKind: "business-analysis-watch",
        prompt: "Summarize internal notes.",
      }),
    ).toBe(true);
  });

  it("does not treat the playbook kind as research on kind alone", () => {
    expect(
      scheduledTaskNeedsExternalResearch({
        taskKind: "product-management-playbook",
        prompt: "Advance the playbook to the next stage.",
      }),
    ).toBe(false);
  });

  it("detects research-shaped prompts", () => {
    const prompts = [
      "Research the top three competitors and summarize positioning.",
      "Do a market scan for HVAC service pricing in Austin.",
      "Check the web for industry news about laundry automation.",
      "Fetch https://example.com/pricing and compare with ours.",
      "Monitor online reviews for sentiment shifts.",
    ];
    for (const prompt of prompts) {
      expect(scheduledTaskNeedsExternalResearch({ prompt })).toBe(true);
    }
  });

  it("leaves internal-work prompts alone", () => {
    const prompts = [
      "Reconcile this month's bills against bank transactions.",
      "Draft a weekly summary of open invoices for the owner.",
      "Review the backlog and propose priorities.",
    ];
    for (const prompt of prompts) {
      expect(scheduledTaskNeedsExternalResearch({ prompt })).toBe(false);
    }
  });

  // BI-PIR-dc81be34: live 2026-10-28, two post-implementation reviews were
  // refused before they ran because the packet named a branch or file with
  // "research" in it. The review reads a bound change; it needs no web.
  it("ignores \"research\" inside a branch name, file path or identifier", () => {
    const prompts = [
      "| For BI-7272643A in WC-FA1FEA9F on OpenDigitalProductFactory/opendigitalproductfactory#codex/research-artifact-reuse at Workroom head 8d73c768, independently address post-implementation-review.",
      "| For BI-0B2C3F6D in WC-FB10BA66 on OpenDigitalProductFactory/opendigitalproductfactory#fix/research-receipt-fields at Workroom head d8892bb2. Read apps/web/lib/build/record-ideate-research-receipt.ts at d8892bb2 with read_source_at_version.",
      "Call start_ideate_research only if the item is still owed, then record the receipt.",
      "Read research.md and research_notes.ts from the bound change.",
    ];
    for (const prompt of prompts) {
      expect(scheduledTaskNeedsExternalResearch({ prompt })).toBe(false);
    }
  });

  it("still detects research written as prose, at a sentence end or beside identifiers", () => {
    const prompts = [
      "Do some research.",
      "Research: who are the leading vendors?",
      "Read fix/research-receipt-fields, then research current industry practice for receipts.",
    ];
    for (const prompt of prompts) {
      expect(scheduledTaskNeedsExternalResearch({ prompt })).toBe(true);
    }
  });
});

describe("assertScheduledResearchCapability", () => {
  const externalTool = { requiresExternalAccess: true };
  const internalTool = { requiresExternalAccess: false };

  it("passes when a research task has an external tool anywhere in its surface", () => {
    expect(() =>
      assertScheduledResearchCapability({
        taskKind: "business-analysis-watch",
        prompt: "Watch the market.",
        agentId: "hive-scout",
        tools: [internalTool, externalTool],
        externalAccess: { enabled: true, reason: "web-search-grant" },
      }),
    ).not.toThrow();
  });

  it("fails loudly when a research task has no external tools", () => {
    expect(() =>
      assertScheduledResearchCapability({
        taskKind: "business-analysis-watch",
        prompt: "Watch the market.",
        agentId: "hive-scout",
        tools: [internalTool],
        externalAccess: { enabled: false, reason: "no-web-search-grant" },
      }),
    ).toThrow(ScheduledResearchUnavailableError);
  });

  it("names the missing grant in the error", () => {
    try {
      assertScheduledResearchCapability({
        prompt: "Research competitor pricing.",
        agentId: "customer-advisor",
        tools: [],
        externalAccess: { enabled: false, reason: "no-web-search-grant" },
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(String(error)).toContain("web_search grant");
      expect(String(error)).toContain("customer-advisor");
    }
  });

  it("is a no-op for tasks that do not need research", () => {
    expect(() =>
      assertScheduledResearchCapability({
        prompt: "Summarize open invoices.",
        agentId: "finance-agent",
        tools: [],
        externalAccess: { enabled: false, reason: "no-web-search-grant" },
      }),
    ).not.toThrow();
  });
});

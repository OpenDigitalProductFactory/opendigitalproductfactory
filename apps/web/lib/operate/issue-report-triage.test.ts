import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildIssueBacklogItem, triageIssueReports, llmTriageReport, checkForSpike, _resetCache } from "./issue-report-triage";

const report = {
  id: "r1",
  reportId: "PIR-ABC12",
  type: "runtime_error",
  severity: "critical",
  title: "Page crash on /platform/ai/providers/ollama",
  description: "Server component render error",
  routeContext: "/platform/ai/providers/ollama",
  errorStack: "Error: Something went wrong\n  at render (file.tsx:42)",
  source: "crash_boundary",
};

beforeEach(() => _resetCache());

describe("buildIssueBacklogItem", () => {
  it("creates item with BI-PIR prefix and issue_report source", () => {
    const item = buildIssueBacklogItem(report, "prod-1", "tax-1");
    expect(item.itemId).toMatch(/^BI-PIR-/);
    expect(item.source).toBe("issue_report");
    expect(item.type).toBe("product");
    expect(item.priority).toBe(1); // critical → 1
    expect(item.digitalProductId).toBe("prod-1");
    expect(item.taxonomyNodeId).toBe("tax-1");
  });

  it("includes report ID in body for traceability", () => {
    const item = buildIssueBacklogItem(report, null, null);
    expect(item.body).toContain("PIR-ABC12");
  });

  it("falls back to portfolio type when no product", () => {
    const item = buildIssueBacklogItem(report, null, null);
    expect(item.type).toBe("portfolio");
  });
});

const triageDeps = (overrides: Record<string, unknown> = {}) => ({
  getOpenReports: async () => [report],
  getExistingTitles: async () => [] as string[],
  createBacklogItem: vi.fn(),
  incrementOccurrence: vi.fn(),
  acknowledgeReport: vi.fn(),
  resolveProductId: async () => "prod-1",
  resolveTaxonomyNodeId: async () => "tax-1",
  ...overrides,
});

describe("triageIssueReports", () => {
  it("creates backlog items for new reports", async () => {
    const created: unknown[] = [];
    const acknowledged: string[] = [];

    const result = await triageIssueReports(triageDeps({
      createBacklogItem: async (data: unknown) => { created.push(data); },
      acknowledgeReport: async (id: string) => { acknowledged.push(id); },
    }));

    expect(result.created).toBe(1);
    expect(result.llmEnhanced).toBe(0);
    expect(created).toHaveLength(1);
    expect(acknowledged).toEqual(["r1"]);
  });

  it("skips duplicates and increments occurrence", async () => {
    const incrementedTitles: string[] = [];
    const created: unknown[] = [];

    const result = await triageIssueReports(triageDeps({
      getExistingTitles: async () => ["Page crash on /platform/ai/providers/ollama"],
      createBacklogItem: async (data: unknown) => { created.push(data); },
      incrementOccurrence: async (title: string) => { incrementedTitles.push(title); },
    }));

    expect(result.created).toBe(0);
    expect(created).toHaveLength(0);
    expect(incrementedTitles).toEqual(["Page crash on /platform/ai/providers/ollama"]);
  });

  it("prevents intra-batch duplicates", async () => {
    const report2 = { ...report, id: "r2", reportId: "PIR-DEF34" };
    const created: unknown[] = [];

    const result = await triageIssueReports(triageDeps({
      getOpenReports: async () => [report, report2],
      createBacklogItem: async (data: unknown) => { created.push(data); },
    }));

    expect(result.created).toBe(1);
    expect(created).toHaveLength(1);
  });

  it("returns 0 for empty reports", async () => {
    const result = await triageIssueReports(triageDeps({
      getOpenReports: async () => [],
    }));

    expect(result.created).toBe(0);
    expect(result.llmEnhanced).toBe(0);
  });

  it("uses LLM triage when callLlm is provided", async () => {
    const created: unknown[] = [];

    const mockLlm = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        severity: "high",
        taxonomyPath: "foundational/platform_services/ai_inference",
        duplicateOf: null,
        rootCause: "Ollama provider endpoint returns malformed JSON when model list is empty",
        suggestedTitle: "Ollama provider page crashes when no models are pulled",
      }),
    });

    const result = await triageIssueReports(triageDeps({
      createBacklogItem: async (data: unknown) => { created.push(data); },
      callLlm: mockLlm,
      resolveTaxonomyNodeByPath: async () => "tax-ai-inference",
    }));

    expect(result.created).toBe(1);
    expect(result.llmEnhanced).toBe(1);
    expect(mockLlm).toHaveBeenCalledOnce();

    const item = created[0] as { title: string; priority: number; body: string; taxonomyNodeId: string };
    expect(item.title).toBe("Ollama provider page crashes when no models are pulled");
    expect(item.priority).toBe(2); // high → 2 (LLM downgraded from critical)
    expect(item.body).toContain("Root cause:");
    expect(item.taxonomyNodeId).toBe("tax-ai-inference");
  });

  it("LLM semantic dedup identifies duplicates by exact title match", async () => {
    const created: unknown[] = [];
    const incremented: string[] = [];

    const mockLlm = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        severity: "critical",
        taxonomyPath: null,
        duplicateOf: "Ollama provider page failure",
        rootCause: null,
        suggestedTitle: "Ollama crash",
      }),
    });

    const result = await triageIssueReports(triageDeps({
      getExistingTitles: async () => ["Ollama provider page failure"],
      createBacklogItem: async (data: unknown) => { created.push(data); },
      incrementOccurrence: async (title: string) => { incremented.push(title); },
      callLlm: mockLlm,
    }));

    expect(result.created).toBe(0);
    expect(created).toHaveLength(0);
    expect(incremented).toEqual(["Ollama provider page failure"]);
  });

  it("falls back to deterministic triage when LLM fails", async () => {
    const created: unknown[] = [];
    const mockLlm = vi.fn().mockRejectedValue(new Error("No model available"));

    const result = await triageIssueReports(triageDeps({
      createBacklogItem: async (data: unknown) => { created.push(data); },
      callLlm: mockLlm,
    }));

    expect(result.created).toBe(1);
    expect(result.llmEnhanced).toBe(0);
    // Falls back to original title and severity
    const item = created[0] as { title: string; priority: number };
    expect(item.title).toBe("Page crash on /platform/ai/providers/ollama");
    expect(item.priority).toBe(1); // original critical → 1
  });
});

describe("llmTriageReport", () => {
  it("parses valid LLM JSON response", async () => {
    const mockLlm = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        severity: "medium",
        taxonomyPath: "foundational/database",
        duplicateOf: null,
        rootCause: "Database connection pool exhausted",
        suggestedTitle: "DB pool exhaustion causes page timeout",
      }),
    });

    const result = await llmTriageReport(report, [], mockLlm);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("medium");
    expect(result!.taxonomyPath).toBe("foundational/database");
    expect(result!.rootCause).toBe("Database connection pool exhausted");
    expect(result!.suggestedTitle).toBe("DB pool exhaustion causes page timeout");
  });

  it("handles markdown-wrapped JSON", async () => {
    const mockLlm = vi.fn().mockResolvedValue({
      content: '```json\n{"severity":"low","taxonomyPath":null,"duplicateOf":null,"rootCause":null,"suggestedTitle":"Minor CSS glitch"}\n```',
    });

    const result = await llmTriageReport(report, [], mockLlm);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("low");
  });

  it("returns null on invalid JSON", async () => {
    const mockLlm = vi.fn().mockResolvedValue({ content: "I can't parse this error" });
    const result = await llmTriageReport(report, [], mockLlm);
    expect(result).toBeNull();
  });

  it("returns null when LLM throws", async () => {
    const mockLlm = vi.fn().mockRejectedValue(new Error("timeout"));
    const result = await llmTriageReport(report, [], mockLlm);
    expect(result).toBeNull();
  });

  it("sanitizes invalid severity to original", async () => {
    const mockLlm = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        severity: "catastrophic",
        taxonomyPath: null,
        duplicateOf: null,
        rootCause: null,
        suggestedTitle: "test",
      }),
    });

    const result = await llmTriageReport(report, [], mockLlm);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("critical"); // falls back to report.severity
  });
});

describe("checkForSpike", () => {
  it("creates spike alert when threshold exceeded", async () => {
    const created: unknown[] = [];

    const spiked = await checkForSpike({
      countReportsInWindow: async () => 15,
      countReportsInRange: async () => 24,
      getExistingTitles: async () => [],
      createBacklogItem: async (data) => { created.push(data); },
    });

    expect(spiked).toBe(true);
    expect(created).toHaveLength(1);
    expect((created[0] as { priority: number }).priority).toBe(1);
    expect((created[0] as { itemId: string }).itemId).toMatch(/^BI-PIR-SPIKE-/);
  });

  it("does not trigger on low volume", async () => {
    const created: unknown[] = [];

    const spiked = await checkForSpike({
      countReportsInWindow: async () => 2,
      countReportsInRange: async () => 100,
      getExistingTitles: async () => [],
      createBacklogItem: async (data) => { created.push(data); },
    });

    expect(spiked).toBe(false);
    expect(created).toHaveLength(0);
  });

  it("deduplicates spike alerts", async () => {
    const created: unknown[] = [];

    const spiked = await checkForSpike({
      countReportsInWindow: async () => 15,
      countReportsInRange: async () => 24,
      getExistingTitles: async () => ["Issue report spike detected — 12 reports in last hour (avg: 0.5/hr)"],
      createBacklogItem: async (data) => { created.push(data); },
    });

    expect(spiked).toBe(false);
    expect(created).toHaveLength(0);
  });
});

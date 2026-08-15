import { describe, expect, it, vi } from "vitest";

import { phraseSummary } from "./phrase";
import type { ImpactCategoryCounts, ImpactItem, InstallSignals } from "./types";

const emptyCounts: ImpactCategoryCounts = {
  breaking: 0, security: 0, feature: 0, fix: 0, performance: 0, dependency: 0, documentation: 0, maintenance: 0, other: 0, total: 0,
};

const emptySignals: InstallSignals = {
  archetypeId: null, industry: null,
  customizationPaths: [], customizationVerticals: [], openIssueKeywords: [], relevantPrLabels: [],
};

const baseItem: ImpactItem = {
  sha: "x".repeat(40),
  description: "do thing",
  type: "feat",
  scope: null,
  category: "feature",
  breaking: false,
  prNumber: null,
  prTitle: null,
  prLabels: [],
  score: 50,
  reasons: [{ kind: "base-weight" }],
  touchesCustomizations: false,
};

describe("phraseSummary", () => {
  it("returns the parsed phrasing when the LLM responds with valid JSON of matching length", async () => {
    const llm = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        headline: "1 new feature since your last upgrade.",
        itemPhrasings: [{ description: "Adds a thing.", whyRelevant: "" }],
        touchesCustomizationsCallout: "",
      }),
    });
    const out = await phraseSummary(
      { items: [baseItem], counts: { ...emptyCounts, feature: 1, total: 1 }, signals: emptySignals },
      { llm },
    );
    expect(out).toEqual({
      headline: "1 new feature since your last upgrade.",
      itemPhrasings: [{ description: "Adds a thing.", whyRelevant: "" }],
      touchesCustomizationsCallout: "",
    });
  });

  it("tolerates LLM responses wrapped in ```json fences", async () => {
    const llm = vi.fn().mockResolvedValue({
      text:
        "```json\n" +
        JSON.stringify({
          headline: "ok",
          itemPhrasings: [{ description: "ok", whyRelevant: "" }],
          touchesCustomizationsCallout: "",
        }) +
        "\n```",
    });
    const out = await phraseSummary(
      { items: [baseItem], counts: emptyCounts, signals: emptySignals },
      { llm },
    );
    expect(out?.headline).toBe("ok");
  });

  it("returns null when length mismatches input items (no silent fabrication)", async () => {
    const llm = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        headline: "ok",
        itemPhrasings: [
          { description: "a", whyRelevant: "" },
          { description: "b", whyRelevant: "" },
        ],
        touchesCustomizationsCallout: "",
      }),
    });
    const out = await phraseSummary(
      { items: [baseItem], counts: emptyCounts, signals: emptySignals },
      { llm },
    );
    expect(out).toBeNull();
  });

  it("returns null when JSON is malformed", async () => {
    const llm = vi.fn().mockResolvedValue({ text: "not json at all" });
    const out = await phraseSummary(
      { items: [baseItem], counts: emptyCounts, signals: emptySignals },
      { llm },
    );
    expect(out).toBeNull();
  });

  it("returns null when LLM throws", async () => {
    const llm = vi.fn().mockRejectedValue(new Error("offline"));
    const out = await phraseSummary(
      { items: [baseItem], counts: emptyCounts, signals: emptySignals },
      { llm },
    );
    expect(out).toBeNull();
  });

  it("returns null when items list is empty (no point phrasing)", async () => {
    const llm = vi.fn();
    const out = await phraseSummary(
      { items: [], counts: emptyCounts, signals: emptySignals },
      { llm },
    );
    expect(out).toBeNull();
    expect(llm).not.toHaveBeenCalled();
  });
});

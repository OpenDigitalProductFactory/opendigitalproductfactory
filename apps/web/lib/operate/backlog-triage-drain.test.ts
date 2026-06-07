import { describe, it, expect, vi } from "vitest";
import {
  parseTriageDecision,
  autoApplyBuildSize,
  runBacklogTriageDrain,
  AUTO_TRIAGE_CONFIDENCE_THRESHOLD,
  type TriageCandidate,
} from "./backlog-triage-drain";

describe("parseTriageDecision", () => {
  it("parses a plain JSON object", () => {
    const d = parseTriageDecision('{"outcome":"build","effortSize":"small","confidence":0.9,"rationale":"clear"}');
    expect(d).toEqual({ outcome: "build", effortSize: "small", confidence: 0.9, rationale: "clear" });
  });

  it("tolerates markdown fences and surrounding prose", () => {
    const d = parseTriageDecision('Here:\n```json\n{"outcome":"needs-human","confidence":0.4}\n```\nthanks');
    expect(d?.outcome).toBe("needs-human");
    expect(d?.confidence).toBe(0.4);
  });

  it("returns null on garbage or missing outcome", () => {
    expect(parseTriageDecision("not json")).toBeNull();
    expect(parseTriageDecision('{"effortSize":"small"}')).toBeNull();
    expect(parseTriageDecision("")).toBeNull();
  });
});

describe("autoApplyBuildSize (safety gate)", () => {
  it("returns the size for a confident, well-formed build", () => {
    expect(autoApplyBuildSize({ outcome: "build", effortSize: "medium", confidence: 0.85 })).toBe("medium");
  });

  it("rejects non-build outcomes", () => {
    expect(autoApplyBuildSize({ outcome: "needs-human", effortSize: "small", confidence: 0.99 })).toBeNull();
    expect(autoApplyBuildSize({ outcome: "discard", confidence: 0.99 })).toBeNull();
  });

  it("rejects low confidence", () => {
    expect(
      autoApplyBuildSize({ outcome: "build", effortSize: "small", confidence: AUTO_TRIAGE_CONFIDENCE_THRESHOLD - 0.01 }),
    ).toBeNull();
  });

  it("rejects missing/invalid effort size", () => {
    expect(autoApplyBuildSize({ outcome: "build", confidence: 0.99 })).toBeNull();
    expect(autoApplyBuildSize({ outcome: "build", effortSize: "huge", confidence: 0.99 })).toBeNull();
  });

  it("rejects null decision", () => {
    expect(autoApplyBuildSize(null)).toBeNull();
  });
});

describe("runBacklogTriageDrain", () => {
  const items: TriageCandidate[] = [
    { itemId: "BI-A", title: "Clear build" },
    { itemId: "BI-B", title: "Ambiguous" },
    { itemId: "BI-C", title: "LLM error" },
  ];

  it("auto-applies only confident builds and leaves the rest for the operator", async () => {
    const applyBuild = vi.fn(async () => {});
    const decide = vi.fn(async (item: TriageCandidate) => {
      if (item.itemId === "BI-A") return '{"outcome":"build","effortSize":"small","confidence":0.95,"rationale":"r"}';
      if (item.itemId === "BI-B") return '{"outcome":"needs-human","confidence":0.5}';
      throw new Error("llm down");
    });

    const result = await runBacklogTriageDrain({
      getTriagingItems: async () => items,
      decide,
      applyBuild,
    });

    expect(result).toEqual({ considered: 3, autoBuilt: 1, leftForOperator: 2 });
    expect(applyBuild).toHaveBeenCalledTimes(1);
    expect(applyBuild).toHaveBeenCalledWith("BI-A", "small", expect.stringContaining("Auto-triaged by scheduled drain"));
  });

  it("counts an item as left-for-operator if applyBuild throws", async () => {
    const result = await runBacklogTriageDrain({
      getTriagingItems: async () => [{ itemId: "BI-X", title: "x" }],
      decide: async () => '{"outcome":"build","effortSize":"medium","confidence":0.9}',
      applyBuild: async () => {
        throw new Error("db down");
      },
    });
    expect(result).toEqual({ considered: 1, autoBuilt: 0, leftForOperator: 1 });
  });

  it("no-ops on an empty queue", async () => {
    const decide = vi.fn();
    const result = await runBacklogTriageDrain({
      getTriagingItems: async () => [],
      decide,
      applyBuild: async () => {},
    });
    expect(result).toEqual({ considered: 0, autoBuilt: 0, leftForOperator: 0 });
    expect(decide).not.toHaveBeenCalled();
  });
});

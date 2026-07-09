import { describe, it, expect } from "vitest";
import {
  classifyConsolidation,
  entrySimilarity,
  DEFAULT_SUPERSEDE_THRESHOLD,
  type ExistingEntry,
} from "./memory-consolidation";

describe("entrySimilarity", () => {
  it("is 1 for identical key+value", () => {
    expect(entrySimilarity({ key: "k", value: "v" }, { key: "k", value: "v" })).toBe(1);
  });
  it("is 0 for disjoint tokens", () => {
    expect(entrySimilarity({ key: "cloud", value: "aws" }, { key: "editor", value: "vim" })).toBe(0);
  });
  it("rises with shared tokens", () => {
    const s = entrySimilarity(
      { key: "preferred_meeting_time", value: "9am" },
      { key: "meeting_time", value: "9am" },
    );
    expect(s).toBeGreaterThan(0.3);
  });
});

describe("classifyConsolidation", () => {
  const existing: ExistingEntry[] = [
    { id: "e1", key: "cloud_provider", value: "AWS" },
    { id: "e2", key: "testing_approach", value: "TDD" },
  ];

  it("ADDs when there is no equivalent or near neighbor", () => {
    const d = classifyConsolidation({ key: "editor", value: "neovim" }, existing);
    expect(d.action).toBe("add");
    expect(d.targetId).toBeNull();
  });

  it("NOOPs on exact key with equivalent value (case/space-insensitive)", () => {
    const d = classifyConsolidation({ key: "cloud_provider", value: "aws" }, existing);
    expect(d.action).toBe("noop");
    expect(d.targetId).toBe("e1");
  });

  it("UPDATEs on exact key with changed value", () => {
    const d = classifyConsolidation({ key: "cloud_provider", value: "GCP" }, existing);
    expect(d.action).toBe("update");
    expect(d.targetId).toBe("e1");
  });

  it("SUPERSEDEs a different-key near-duplicate with a changed value", () => {
    // High lexical overlap on key+value, different value → supersede the neighbor.
    const near: ExistingEntry[] = [
      { id: "n1", key: "preferred_cloud_provider", value: "AWS us-east-1" },
    ];
    const d = classifyConsolidation(
      { key: "cloud_provider_preferred", value: "AWS us-west-2" },
      near,
    );
    expect(d.action).toBe("supersede");
    expect(d.targetId).toBe("n1");
  });

  it("NOOPs a different-key near-duplicate that restates the same value", () => {
    const near: ExistingEntry[] = [
      { id: "n1", key: "preferred_cloud_provider", value: "AWS us-east-1" },
    ];
    const d = classifyConsolidation(
      { key: "cloud_provider_preferred", value: "aws us-east-1" },
      near,
    );
    expect(d.action).toBe("noop");
    expect(d.targetId).toBe("n1");
  });

  it("respects a custom supersede threshold", () => {
    const near: ExistingEntry[] = [{ id: "n1", key: "a b c", value: "x y" }];
    // Moderately similar candidate; a very high threshold forces ADD.
    const d = classifyConsolidation({ key: "a b", value: "z" }, near, {
      supersedeThreshold: 0.99,
    });
    expect(d.action).toBe("add");
  });

  it("ADDs against an empty store", () => {
    expect(classifyConsolidation({ key: "k", value: "v" }, []).action).toBe("add");
  });

  it("uses the documented default threshold", () => {
    expect(DEFAULT_SUPERSEDE_THRESHOLD).toBeGreaterThan(0.5);
    expect(DEFAULT_SUPERSEDE_THRESHOLD).toBeLessThan(1);
  });
});

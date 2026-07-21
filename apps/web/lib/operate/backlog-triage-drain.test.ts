import { describe, it, expect, vi } from "vitest";
import {
  parseTriageDecision,
  autoApplyBuildSize,
  authorEffortSize,
  buildTriageDrainPrompt,
  runBacklogTriageDrain,
  triageOneItem,
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

  // BI-TRIAGE-SIZE-OVERWRITE: a deliberate author size must survive the drain.
  it("preserves a valid author-provided size instead of the LLM re-estimate", () => {
    expect(
      autoApplyBuildSize(
        { outcome: "build", effortSize: "medium", confidence: 0.95 },
        { itemId: "BI-1", title: "t", effortSize: "large" },
      ),
    ).toBe("large");
  });

  it("falls back to the LLM size when the item has no valid author size", () => {
    expect(
      autoApplyBuildSize(
        { outcome: "build", effortSize: "small", confidence: 0.95 },
        { itemId: "BI-2", title: "t", effortSize: null },
      ),
    ).toBe("small");
    expect(
      autoApplyBuildSize(
        { outcome: "build", effortSize: "small", confidence: 0.95 },
        { itemId: "BI-3", title: "t", effortSize: "huge" /* invalid */ },
      ),
    ).toBe("small");
  });

  it("does not let an author size bypass the build / confidence gate", () => {
    // needs-human still defers even when the item carries a size.
    expect(
      autoApplyBuildSize(
        { outcome: "needs-human", confidence: 0.99 },
        { itemId: "BI-4", title: "t", effortSize: "large" },
      ),
    ).toBeNull();
    // Low confidence still defers even when the item carries a size.
    expect(
      autoApplyBuildSize(
        { outcome: "build", effortSize: "large", confidence: AUTO_TRIAGE_CONFIDENCE_THRESHOLD - 0.01 },
        { itemId: "BI-5", title: "t", effortSize: "large" },
      ),
    ).toBeNull();
  });
});

describe("triageOneItem (per-item unit the Inngest steps run)", () => {
  const item: TriageCandidate = { itemId: "BI-A", title: "Clear build" };

  it("auto-builds a confident build and returns 'auto-built'", async () => {
    const applyBuild = vi.fn(async () => {});
    const outcome = await triageOneItem(item, {
      decide: async () => '{"outcome":"build","effortSize":"small","confidence":0.95,"rationale":"r"}',
      applyBuild,
    });
    expect(outcome).toBe("auto-built");
    expect(applyBuild).toHaveBeenCalledWith("BI-A", "small", expect.stringContaining("Auto-triaged by scheduled drain"));
  });

  it("leaves a needs-human decision for the operator", async () => {
    const applyBuild = vi.fn(async () => {});
    const outcome = await triageOneItem(item, {
      decide: async () => '{"outcome":"needs-human","confidence":0.5}',
      applyBuild,
    });
    expect(outcome).toBe("left-for-operator");
    expect(applyBuild).not.toHaveBeenCalled();
  });

  it("treats a thrown decide() as left-for-operator (never throws)", async () => {
    const outcome = await triageOneItem(item, {
      decide: async () => {
        throw new Error("llm down");
      },
      applyBuild: async () => {},
    });
    expect(outcome).toBe("left-for-operator");
  });

  it("treats a thrown applyBuild() as left-for-operator", async () => {
    const outcome = await triageOneItem(item, {
      decide: async () => '{"outcome":"build","effortSize":"medium","confidence":0.9}',
      applyBuild: async () => {
        throw new Error("db down");
      },
    });
    expect(outcome).toBe("left-for-operator");
  });
});

describe("authorEffortSize", () => {
  it("returns a valid author size and null otherwise", () => {
    expect(authorEffortSize({ itemId: "BI-1", title: "t", effortSize: "xlarge" })).toBe("xlarge");
    expect(authorEffortSize({ itemId: "BI-2", title: "t", effortSize: null })).toBeNull();
    expect(authorEffortSize({ itemId: "BI-3", title: "t", effortSize: "huge" })).toBeNull();
    expect(authorEffortSize({ itemId: "BI-4", title: "t" })).toBeNull();
    expect(authorEffortSize(null)).toBeNull();
  });
});

describe("buildTriageDrainPrompt", () => {
  it("includes the author effortSize + proposedOutcome as non-binding priors when present", () => {
    const prompt = buildTriageDrainPrompt({
      itemId: "BI-P",
      title: "Sized item",
      effortSize: "large",
      proposedOutcome: "build",
    });
    // The distinctive prior LINES are emitted (note: the static instruction also
    // mentions the token "AUTHOR_EFFORT_SIZE", so match on the line prefix).
    expect(prompt).toContain("AUTHOR_EFFORT_SIZE (prior");
    expect(prompt).toMatch(/AUTHOR_EFFORT_SIZE \(prior[^\n]*: large/);
    expect(prompt).toContain("AUTHOR_PROPOSED_OUTCOME (prior");
    // The guidance to not re-estimate is present.
    expect(prompt).toContain("do not re-estimate the size");
  });

  it("omits the prior lines when the item has no author size or outcome", () => {
    const prompt = buildTriageDrainPrompt({ itemId: "BI-Q", title: "Unsized item" });
    // No prior LINES are emitted (the instruction text may still reference the token).
    expect(prompt).not.toContain("AUTHOR_EFFORT_SIZE (prior");
    expect(prompt).not.toContain("AUTHOR_PROPOSED_OUTCOME (prior");
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

  // BI-TRIAGE-SIZE-OVERWRITE regression (a): a deliberate author size survives a
  // confident build decision instead of being overwritten by the LLM's guess.
  it("preserves an author-provided effortSize on auto-build (no blind overwrite)", async () => {
    const applyBuild = vi.fn(async () => {});
    // LLM confidently says BUILD but re-estimates the size to "medium"; the author said "large".
    const decide = vi.fn(
      async () => '{"outcome":"build","effortSize":"medium","confidence":0.95,"rationale":"r"}',
    );

    const result = await runBacklogTriageDrain({
      getTriagingItems: async () => [{ itemId: "BI-SIZED", title: "Author-sized", effortSize: "large" }],
      decide,
      applyBuild,
    });

    expect(result).toEqual({ considered: 1, autoBuilt: 1, leftForOperator: 0 });
    // The author's "large" is preserved — NOT the LLM's "medium".
    expect(applyBuild).toHaveBeenCalledWith("BI-SIZED", "large", expect.any(String));
  });

  // BI-TRIAGE-SIZE-OVERWRITE regression (b): the autonomous-capture path still
  // works — an item filed with no size gets the LLM-decided size.
  it("uses the LLM-decided size for an item captured with no size", async () => {
    const applyBuild = vi.fn(async () => {});
    const decide = vi.fn(
      async () => '{"outcome":"build","effortSize":"small","confidence":0.95,"rationale":"r"}',
    );

    const result = await runBacklogTriageDrain({
      getTriagingItems: async () => [{ itemId: "BI-UNSIZED", title: "No author size" }],
      decide,
      applyBuild,
    });

    expect(result).toEqual({ considered: 1, autoBuilt: 1, leftForOperator: 0 });
    // No author size → fall back to the LLM's size.
    expect(applyBuild).toHaveBeenCalledWith("BI-UNSIZED", "small", expect.any(String));
  });
});

// BI-BB2E585C. The drain mutates governed BacklogItem state from a model
// decision, hourly and unattended. It previously wrote no DecisionInteraction
// row at all, so the decision log an operator reviews to answer "what is my AI
// workforce deciding?" silently omitted the platform's most frequent
// autonomous writer — reading as coverage rather than as a gap.
describe("triageOneItem governance ledger (BI-BB2E585C)", () => {
  const item: TriageCandidate = { itemId: "BI-LEDGER", title: "Clear build" };
  const confidentBuild = '{"outcome":"build","effortSize":"small","confidence":0.95,"rationale":"clear"}';

  it("records the decision BEFORE applying the mutation", async () => {
    const order: string[] = [];
    const recordDecision = vi.fn(async () => {
      order.push("ledger");
      return true;
    });
    const applyBuild = vi.fn(async () => {
      order.push("mutate");
    });

    const outcome = await triageOneItem(item, {
      decide: async () => confidentBuild,
      applyBuild,
      recordDecision,
    });

    expect(outcome).toBe("auto-built");
    expect(order).toEqual(["ledger", "mutate"]);
    expect(recordDecision).toHaveBeenCalledWith(
      item,
      expect.objectContaining({ outcome: "build" }),
      "small",
    );
  });

  it("fail-closed: does NOT mutate when the decision cannot be ledgered", async () => {
    const applyBuild = vi.fn(async () => {});
    const outcome = await triageOneItem(item, {
      decide: async () => confidentBuild,
      applyBuild,
      recordDecision: async () => false,
    });

    expect(outcome).toBe("left-for-operator");
    expect(applyBuild).not.toHaveBeenCalled();
  });

  it("fail-closed: a throwing ledger blocks the mutation rather than the drain", async () => {
    const applyBuild = vi.fn(async () => {});
    const outcome = await triageOneItem(item, {
      decide: async () => confidentBuild,
      applyBuild,
      recordDecision: async () => {
        throw new Error("db down");
      },
    });

    expect(outcome).toBe("left-for-operator");
    expect(applyBuild).not.toHaveBeenCalled();
  });

  it("never ledgers a decision it was not going to apply", async () => {
    const recordDecision = vi.fn(async () => true);
    const outcome = await triageOneItem(item, {
      decide: async () => '{"outcome":"needs-human","confidence":0.5}',
      applyBuild: async () => {},
      recordDecision,
    });

    expect(outcome).toBe("left-for-operator");
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("passes the APPLIED size to the ledger, not the model's overridden one", async () => {
    // Author intent wins over the model's re-estimate (BI-TRIAGE-SIZE-OVERWRITE);
    // the ledger must record what was actually written to the row.
    const recordDecision = vi.fn(async () => true);
    await triageOneItem(
      { itemId: "BI-SIZED", title: "Authored size", effortSize: "large" },
      {
        decide: async () => confidentBuild, // model says "small"
        applyBuild: async () => {},
        recordDecision,
      },
    );

    expect(recordDecision).toHaveBeenCalledWith(expect.anything(), expect.anything(), "large");
  });
});

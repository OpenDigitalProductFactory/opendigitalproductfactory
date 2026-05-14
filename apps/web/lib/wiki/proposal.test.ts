import { describe, expect, it, vi } from "vitest";

import {
  buildAbstractPrompt,
  buildClaimsPrompt,
  buildStanceHeuristicsPrompt,
  extractJsonObject,
  parseClaimsResponse,
  parseStanceHeuristicsResponse,
  proposeWikiDiff,
  type ExistingSlugSnapshot,
  type InferenceCallable,
  type ProposalSource,
} from "./proposal";
import type { ExistingSlugSnapshot as SchemaSnapshot } from "./schema-context";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeSnapshot(partial?: Partial<SchemaSnapshot["byKind"]>): ExistingSlugSnapshot {
  const byKind = {
    entity: partial?.entity ?? ["entities/digital-product", "entities/portfolio"],
    stance: partial?.stance ?? ["stances/it4it-is-substrate"],
    heuristic: partial?.heuristic ?? ["heuristics/auto-populate-or-its-wrong"],
    principle: partial?.principle ?? [],
    summary: partial?.summary ?? [],
    decision: partial?.decision ?? [],
    runbook: partial?.runbook ?? [],
  };
  return {
    all: Object.values(byKind).flat().sort(),
    byKind,
  };
}

const SOURCE: ProposalSource = {
  sourceKey: "articles/example",
  title: "Why one data model wins",
  body:
    "The two-system pattern fails on reconciliation. Pick one canonical model and accept the depth gap.",
  abstract: "Already-existing abstract paragraph.",
};

// ─── Prompt builders ────────────────────────────────────────────────────────

describe("buildAbstractPrompt", () => {
  it("targets utility tier with a short system prompt", () => {
    const req = buildAbstractPrompt(SOURCE);
    expect(req.tier).toBe("utility");
    expect(req.systemPrompt.length).toBeLessThan(400);
    expect(req.userPrompt).toContain("Title: Why one data model wins");
    expect(req.userPrompt).toContain(SOURCE.body);
  });

  it("clamps very long bodies and leaves a truncation marker", () => {
    const longBody = "a".repeat(20_000);
    const req = buildAbstractPrompt({ ...SOURCE, body: longBody });
    expect(req.userPrompt).toContain("[…truncated for prompt");
    expect(req.userPrompt.length).toBeLessThan(20_000);
  });
});

describe("buildClaimsPrompt", () => {
  it("includes the SCHEMA preamble, existing slugs, and the strict JSON contract", () => {
    const snapshot = makeSnapshot();
    const req = buildClaimsPrompt(SOURCE, snapshot);

    expect(req.tier).toBe("reasoning");
    // Schema preamble fragments.
    expect(req.systemPrompt).toContain("PAGE KINDS");
    expect(req.systemPrompt).toContain("entities/digital-product");
    // Pass-specific contract.
    expect(req.systemPrompt).toContain("CLAIM EXTRACTION");
    expect(req.systemPrompt).toMatch(/OUTPUT SHAPE.*claims/s);
    // User prompt includes existing slugs + source body.
    expect(req.userPrompt).toContain("EXISTING SLUGS:");
    expect(req.userPrompt).toContain("entities/digital-product");
    expect(req.userPrompt).toContain(SOURCE.body);
  });

  it("renders empty kinds as `(none yet)` rather than dropping them", () => {
    const snapshot = makeSnapshot({ stance: [], heuristic: [] });
    const req = buildClaimsPrompt(SOURCE, snapshot);
    expect(req.userPrompt).toContain("stance (none yet):");
    expect(req.userPrompt).toContain("heuristic (none yet):");
  });
});

describe("buildStanceHeuristicsPrompt", () => {
  it("targets reasoning tier and asks for stances + heuristics arrays", () => {
    const req = buildStanceHeuristicsPrompt(SOURCE, makeSnapshot());
    expect(req.tier).toBe("reasoning");
    expect(req.systemPrompt).toContain("STANCE + HEURISTIC EXTRACTION");
    expect(req.systemPrompt).toMatch(/OUTPUT SHAPE.*stances.*heuristics/s);
    expect(req.userPrompt).toContain("EXISTING STANCES:");
    expect(req.userPrompt).toContain("EXISTING HEURISTICS:");
  });
});

// ─── JSON extraction ────────────────────────────────────────────────────────

describe("extractJsonObject", () => {
  it("parses bare JSON", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses JSON inside a ```json fenced block", () => {
    const text = "Sure, here it is:\n```json\n{\"a\":2}\n```\n";
    expect(extractJsonObject(text)).toEqual({ a: 2 });
  });

  it("parses JSON inside a bare ``` fenced block", () => {
    expect(extractJsonObject("```\n{\"a\":3}\n```\n")).toEqual({ a: 3 });
  });

  it("recovers JSON when preceded by prose", () => {
    expect(extractJsonObject("Result: {\"a\":4}")).toEqual({ a: 4 });
  });

  it("returns null on unrecoverable input", () => {
    expect(extractJsonObject("just prose")).toBeNull();
    expect(extractJsonObject("")).toBeNull();
    expect(extractJsonObject("{bad json")).toBeNull();
  });
});

// ─── parseClaimsResponse ────────────────────────────────────────────────────

describe("parseClaimsResponse", () => {
  it("accepts a well-formed claim targeting an existing entity", () => {
    const snapshot = makeSnapshot();
    const json = JSON.stringify({
      claims: [
        {
          claim: "Digital Product is the unit of organization.",
          target_slug: "entities/digital-product",
          page_kind: "entity",
          propose_new: false,
          confidence: 0.9,
          supporting_excerpt: "Pick one canonical model and accept the depth gap.",
        },
      ],
    });
    const result = parseClaimsResponse(json, snapshot);
    expect(result.parseErrors).toEqual([]);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].proposeNew).toBe(false);
    expect(result.claims[0].confidence).toBe(0.9);
  });

  it("flips propose_new when the LLM's flag disagrees with reality + records a parse error", () => {
    const snapshot = makeSnapshot();
    const json = JSON.stringify({
      claims: [
        {
          claim: "Foo",
          target_slug: "entities/digital-product",
          page_kind: "entity",
          propose_new: true, // wrong — the slug already exists
          confidence: 0.5,
          supporting_excerpt: "...",
        },
      ],
    });
    const result = parseClaimsResponse(json, snapshot);
    expect(result.claims[0].proposeNew).toBe(false);
    expect(result.parseErrors.length).toBeGreaterThan(0);
    expect(result.parseErrors[0]).toMatch(/propose_new/);
  });

  it("flags slug/kind mismatch and drops the row", () => {
    const snapshot = makeSnapshot();
    const json = JSON.stringify({
      claims: [
        {
          claim: "Mismatched",
          target_slug: "entities/foo",
          page_kind: "stance", // doesn't match entities/ prefix
          propose_new: true,
          confidence: 0.5,
          supporting_excerpt: "...",
        },
      ],
    });
    const result = parseClaimsResponse(json, snapshot);
    expect(result.claims).toHaveLength(0);
    expect(result.parseErrors[0]).toMatch(/does not match page_kind/);
  });

  it("rejects rows missing required fields without throwing", () => {
    const snapshot = makeSnapshot();
    const json = JSON.stringify({
      claims: [
        { target_slug: "entities/digital-product", page_kind: "entity" }, // no claim, no excerpt, no confidence
        {
          claim: "Valid",
          target_slug: "entities/digital-product",
          page_kind: "entity",
          propose_new: false,
          confidence: 0.7,
          supporting_excerpt: "ok",
        },
      ],
    });
    const result = parseClaimsResponse(json, snapshot);
    expect(result.claims).toHaveLength(1);
    expect(result.parseErrors.length).toBeGreaterThan(0);
  });

  it("clamps confidence values to [0,1]", () => {
    const snapshot = makeSnapshot();
    const json = JSON.stringify({
      claims: [
        {
          claim: "Over-confident",
          target_slug: "entities/digital-product",
          page_kind: "entity",
          propose_new: false,
          confidence: 5,
          supporting_excerpt: "...",
        },
        {
          claim: "Negative confidence",
          target_slug: "entities/portfolio",
          page_kind: "entity",
          propose_new: false,
          confidence: -0.5,
          supporting_excerpt: "...",
        },
      ],
    });
    const result = parseClaimsResponse(json, snapshot);
    expect(result.claims[0].confidence).toBe(1);
    expect(result.claims[1].confidence).toBe(0);
  });

  it("surfaces a single parse error when the LLM returns prose only", () => {
    const result = parseClaimsResponse("I cannot help with that.", makeSnapshot());
    expect(result.claims).toEqual([]);
    expect(result.parseErrors[0]).toMatch(/could not extract a JSON object/);
  });
});

// ─── parseStanceHeuristicsResponse ──────────────────────────────────────────

describe("parseStanceHeuristicsResponse", () => {
  it("partitions stances and heuristics, marks new vs existing", () => {
    const snapshot = makeSnapshot();
    const json = JSON.stringify({
      stances: [
        {
          statement: "Consolidate on one data model.",
          target_slug: "stances/one-data-model",
          propose_new: true,
          supporting_excerpt: "...",
        },
        {
          statement: "IT4IT is the substrate.",
          target_slug: "stances/it4it-is-substrate", // exists in snapshot
          propose_new: true,
          supporting_excerpt: "...",
        },
      ],
      heuristics: [
        {
          rule: "When in doubt, auto-populate.",
          target_slug: "heuristics/auto-populate-or-its-wrong", // exists
          propose_new: true,
          supporting_excerpt: "...",
        },
      ],
    });
    const result = parseStanceHeuristicsResponse(json, snapshot);
    expect(result.stances).toHaveLength(2);
    expect(result.stances[0].proposeNew).toBe(true); // new
    expect(result.stances[1].proposeNew).toBe(false); // existing — corrected
    expect(result.heuristics[0].proposeNew).toBe(false);
  });

  it("rejects stances and heuristics with wrong prefix", () => {
    const json = JSON.stringify({
      stances: [
        { statement: "x", target_slug: "entities/foo", propose_new: true, supporting_excerpt: "y" },
      ],
      heuristics: [
        { rule: "x", target_slug: "stances/wrong", propose_new: true, supporting_excerpt: "y" },
      ],
    });
    const result = parseStanceHeuristicsResponse(json, makeSnapshot());
    expect(result.stances).toEqual([]);
    expect(result.heuristics).toEqual([]);
    expect(result.parseErrors.some((e) => e.includes("must start with"))).toBe(true);
  });

  it("treats missing arrays as a parse error but does not throw", () => {
    const result = parseStanceHeuristicsResponse("{}", makeSnapshot());
    expect(result.stances).toEqual([]);
    expect(result.heuristics).toEqual([]);
    expect(result.parseErrors.some((e) => e.includes("stances"))).toBe(true);
    expect(result.parseErrors.some((e) => e.includes("heuristics"))).toBe(true);
  });
});

// ─── Orchestrator ───────────────────────────────────────────────────────────

describe("proposeWikiDiff", () => {
  it("calls all three passes when no abstract exists; aggregates results", async () => {
    const snapshot = makeSnapshot();
    const sourceNoAbstract: ProposalSource = { ...SOURCE, abstract: null };

    const infer: InferenceCallable = vi.fn(async (req) => {
      if (req.systemPrompt.includes("Write a one-paragraph abstract")) {
        return "  Synthesised abstract.  ";
      }
      if (req.systemPrompt.includes("CLAIM EXTRACTION")) {
        return JSON.stringify({
          claims: [
            {
              claim: "One canonical model wins.",
              target_slug: "principles/one-data-model",
              page_kind: "principle",
              propose_new: true,
              confidence: 0.85,
              supporting_excerpt: "Pick one canonical model and accept the depth gap.",
            },
          ],
        });
      }
      if (req.systemPrompt.includes("STANCE + HEURISTIC EXTRACTION")) {
        return JSON.stringify({
          stances: [
            {
              statement: "Two-system integration always decays.",
              target_slug: "stances/dont-integrate-ea-platform",
              propose_new: true,
              supporting_excerpt: "The two-system pattern fails on reconciliation.",
            },
          ],
          heuristics: [],
        });
      }
      throw new Error(`unexpected prompt: ${req.systemPrompt.slice(0, 60)}`);
    });

    const proposal = await proposeWikiDiff({
      source: sourceNoAbstract,
      snapshot,
      infer,
    });

    expect(proposal.abstract).toBe("Synthesised abstract.");
    expect(proposal.claims).toHaveLength(1);
    expect(proposal.claims[0].targetSlug).toBe("principles/one-data-model");
    expect(proposal.stances).toHaveLength(1);
    expect(proposal.heuristics).toEqual([]);
    expect(proposal.parseErrors).toEqual([]);
    expect(infer).toHaveBeenCalledTimes(3);
  });

  it("skips pass 1 when reuseExistingAbstract is true (default) and source has an abstract", async () => {
    const infer: InferenceCallable = vi.fn(async (req) => {
      if (req.systemPrompt.includes("Write a one-paragraph abstract")) {
        throw new Error("abstract pass should not be called");
      }
      return "{}";
    });

    const proposal = await proposeWikiDiff({
      source: SOURCE,
      snapshot: makeSnapshot(),
      infer,
    });
    expect(proposal.abstract).toBe("Already-existing abstract paragraph.");
    expect(infer).toHaveBeenCalledTimes(2);
  });

  it("regenerates abstract when reuseExistingAbstract=false", async () => {
    const infer: InferenceCallable = vi.fn(async (req) => {
      if (req.systemPrompt.includes("Write a one-paragraph abstract")) return "Fresh abstract.";
      return "{}";
    });
    const proposal = await proposeWikiDiff({
      source: SOURCE,
      snapshot: makeSnapshot(),
      infer,
      reuseExistingAbstract: false,
    });
    expect(proposal.abstract).toBe("Fresh abstract.");
  });

  it("surfaces pass failures as parseErrors rather than throwing", async () => {
    const infer: InferenceCallable = async (req) => {
      if (req.systemPrompt.includes("CLAIM EXTRACTION")) {
        throw new Error("provider unavailable");
      }
      return "{}";
    };
    const proposal = await proposeWikiDiff({
      source: SOURCE,
      snapshot: makeSnapshot(),
      infer,
    });
    expect(proposal.claims).toEqual([]);
    expect(proposal.parseErrors.some((e) => e.includes("provider unavailable"))).toBe(true);
  });

  it("passes the existing-slug snapshot into the claims and stance prompts", async () => {
    const infer: InferenceCallable = vi.fn(async () => "{}");
    const snapshot = makeSnapshot({ stance: ["stances/one"], heuristic: ["heuristics/one"] });
    await proposeWikiDiff({ source: SOURCE, snapshot, infer });
    const calls = (infer as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].userPrompt).toContain("stances/one");
    expect(calls[0][0].userPrompt).toContain("heuristics/one");
    expect(calls[1][0].userPrompt).toContain("stances/one");
    expect(calls[1][0].userPrompt).toContain("heuristics/one");
  });
});

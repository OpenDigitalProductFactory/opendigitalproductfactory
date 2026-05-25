// apps/web/lib/build/decomposition-candidates.test.ts
//
// Coverage for Phase 4a candidate parsing + validation.
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md
// BI: BI-2E6CC391.

import { describe, expect, it } from "vitest";

import type { BuildDesignDoc } from "@/lib/explore/feature-build-types";

import {
  candidateToChildDesignDocs,
  parseCandidatesResponse,
  validateCandidate,
  type DecompositionCandidate,
} from "./decomposition-candidates";

function makeDoc(overrides: Partial<BuildDesignDoc> = {}): BuildDesignDoc {
  return {
    problemStatement: "Stop techs driving back to the warehouse.",
    reusePlan: "No existing inventory substrate.",
    proposedApproach: "Inventory list + usage POST + low-stock badge.",
    acceptanceCriteria: [
      "AC1: Tech sees truck inventory.",
      "AC2: Tech records usage.",
      "AC3: Idempotency on usage POST.",
      "AC4: Low-stock badge on UI.",
      "AC5: Dispatch rollup view.",
    ],
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<DecompositionCandidate> = {}): DecompositionCandidate {
  return {
    candidateId: "candidate-1",
    rationale: "Split read from usage from rollup.",
    childScopes: [
      {
        childOrder: 1,
        title: "Truck inventory read",
        summary: "Show parts on each truck.",
        acceptanceCriteriaIndices: [0],
        dependsOn: [],
      },
      {
        childOrder: 2,
        title: "Record usage",
        summary: "Mark parts used.",
        acceptanceCriteriaIndices: [1, 2],
        dependsOn: [1],
      },
      {
        childOrder: 3,
        title: "Low-stock surfacing",
        summary: "Restock visibility.",
        acceptanceCriteriaIndices: [3, 4],
        dependsOn: [1, 2],
      },
    ],
    ...overrides,
  };
}

describe("parseCandidatesResponse — happy paths", () => {
  it("parses a bare array of candidates", () => {
    const raw = JSON.stringify([makeCandidate()]);
    const parsed = parseCandidatesResponse(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.candidateId).toBe("candidate-1");
    expect(parsed[0]!.childScopes).toHaveLength(3);
  });

  it("parses a {candidates: [...]} envelope", () => {
    const raw = JSON.stringify({ candidates: [makeCandidate()] });
    const parsed = parseCandidatesResponse(raw);
    expect(parsed).toHaveLength(1);
  });

  it("strips ```json fences", () => {
    const raw = "```json\n" + JSON.stringify([makeCandidate()]) + "\n```";
    const parsed = parseCandidatesResponse(raw);
    expect(parsed).toHaveLength(1);
  });

  it("fills defaults for missing fields", () => {
    const raw = JSON.stringify([
      {
        rationale: "Some rationale",
        childScopes: [{ childOrder: 1, title: "Foo" }],
      },
    ]);
    const parsed = parseCandidatesResponse(raw);
    expect(parsed[0]!.candidateId).toBe("candidate-1"); // generated default
    expect(parsed[0]!.childScopes[0]!.summary).toBe("");
    expect(parsed[0]!.childScopes[0]!.acceptanceCriteriaIndices).toEqual([]);
    expect(parsed[0]!.childScopes[0]!.dependsOn).toEqual([]);
  });
});

describe("parseCandidatesResponse — failure paths", () => {
  it("returns [] on malformed JSON", () => {
    expect(parseCandidatesResponse("not json")).toEqual([]);
    expect(parseCandidatesResponse("{ truncated:")).toEqual([]);
  });

  it("returns [] on unexpected top-level shape", () => {
    expect(parseCandidatesResponse(JSON.stringify("string"))).toEqual([]);
    expect(parseCandidatesResponse(JSON.stringify({ foo: "bar" }))).toEqual([]);
    expect(parseCandidatesResponse(JSON.stringify(null))).toEqual([]);
  });

  it("skips non-object items inside the candidates array", () => {
    const raw = JSON.stringify([null, "string", makeCandidate(), 42]);
    const parsed = parseCandidatesResponse(raw);
    expect(parsed).toHaveLength(1);
  });
});

describe("validateCandidate — happy paths", () => {
  it("accepts a well-formed candidate that partitions all ACs", () => {
    const result = validateCandidate(makeCandidate(), makeDoc());
    expect(result.ok).toBe(true);
  });

  it("accepts a 2-child partition", () => {
    const candidate = makeCandidate({
      childScopes: [
        { childOrder: 1, title: "Read", summary: "x", acceptanceCriteriaIndices: [0, 3], dependsOn: [] },
        { childOrder: 2, title: "Write", summary: "y", acceptanceCriteriaIndices: [1, 2, 4], dependsOn: [1] },
      ],
    });
    const result = validateCandidate(candidate, makeDoc());
    expect(result.ok).toBe(true);
  });

  it("accepts a 4-child partition (max allowed)", () => {
    const doc = makeDoc({
      acceptanceCriteria: ["a", "b", "c", "d", "e", "f", "g", "h"],
    });
    const candidate: DecompositionCandidate = {
      candidateId: "c4",
      rationale: "Four-way split",
      childScopes: [
        { childOrder: 1, title: "A", summary: "a", acceptanceCriteriaIndices: [0, 1], dependsOn: [] },
        { childOrder: 2, title: "B", summary: "b", acceptanceCriteriaIndices: [2, 3], dependsOn: [1] },
        { childOrder: 3, title: "C", summary: "c", acceptanceCriteriaIndices: [4, 5], dependsOn: [2] },
        { childOrder: 4, title: "D", summary: "d", acceptanceCriteriaIndices: [6, 7], dependsOn: [3] },
      ],
    };
    const result = validateCandidate(candidate, doc);
    expect(result.ok).toBe(true);
  });
});

describe("validateCandidate — failure paths", () => {
  it("rejects too few children (< 2)", () => {
    const candidate = makeCandidate({
      childScopes: [
        {
          childOrder: 1,
          title: "Solo",
          summary: "x",
          acceptanceCriteriaIndices: [0, 1, 2, 3, 4],
          dependsOn: [],
        },
      ],
    });
    const result = validateCandidate(candidate, makeDoc());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failures.map((f) => f.code)).toContain("too-few-children");
  });

  it("rejects too many children (> 4)", () => {
    const doc = makeDoc({
      acceptanceCriteria: ["a", "b", "c", "d", "e"],
    });
    const candidate: DecompositionCandidate = {
      candidateId: "c5",
      rationale: "Five-way split",
      childScopes: [
        { childOrder: 1, title: "A", summary: "", acceptanceCriteriaIndices: [0], dependsOn: [] },
        { childOrder: 2, title: "B", summary: "", acceptanceCriteriaIndices: [1], dependsOn: [] },
        { childOrder: 3, title: "C", summary: "", acceptanceCriteriaIndices: [2], dependsOn: [] },
        { childOrder: 4, title: "D", summary: "", acceptanceCriteriaIndices: [3], dependsOn: [] },
        { childOrder: 5, title: "E", summary: "", acceptanceCriteriaIndices: [4], dependsOn: [] },
      ],
    };
    const result = validateCandidate(candidate, doc);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failures.map((f) => f.code)).toContain("too-many-children");
  });

  it("rejects missing AC coverage", () => {
    const candidate = makeCandidate({
      childScopes: [
        { childOrder: 1, title: "A", summary: "", acceptanceCriteriaIndices: [0, 1], dependsOn: [] },
        { childOrder: 2, title: "B", summary: "", acceptanceCriteriaIndices: [2], dependsOn: [] },
        // ACs 3 and 4 are not assigned to anyone.
      ],
    });
    const result = validateCandidate(candidate, makeDoc());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failures.map((f) => f.code).filter((c) => c === "missing-ac-coverage").length).toBe(2);
  });

  it("rejects duplicate AC coverage", () => {
    const candidate = makeCandidate({
      childScopes: [
        { childOrder: 1, title: "A", summary: "", acceptanceCriteriaIndices: [0, 1, 2], dependsOn: [] },
        { childOrder: 2, title: "B", summary: "", acceptanceCriteriaIndices: [2, 3, 4], dependsOn: [] },
        // AC 2 is in BOTH children.
      ],
    });
    const result = validateCandidate(candidate, makeDoc());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failures.map((f) => f.code)).toContain("duplicate-ac-coverage");
  });

  it("rejects out-of-range AC index", () => {
    const candidate = makeCandidate({
      childScopes: [
        { childOrder: 1, title: "A", summary: "", acceptanceCriteriaIndices: [0, 1, 2], dependsOn: [] },
        { childOrder: 2, title: "B", summary: "", acceptanceCriteriaIndices: [3, 4, 99], dependsOn: [] },
      ],
    });
    const result = validateCandidate(candidate, makeDoc());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failures.map((f) => f.code)).toContain("ac-index-out-of-range");
  });

  it("rejects duplicate childOrder", () => {
    const candidate = makeCandidate({
      childScopes: [
        { childOrder: 1, title: "A", summary: "", acceptanceCriteriaIndices: [0, 1, 2], dependsOn: [] },
        { childOrder: 1, title: "B", summary: "", acceptanceCriteriaIndices: [3, 4], dependsOn: [] },
      ],
    });
    const result = validateCandidate(candidate, makeDoc());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failures.map((f) => f.code)).toContain("duplicate-child-order");
  });

  it("rejects non-sequential childOrder (e.g. 1, 3 instead of 1, 2)", () => {
    const candidate = makeCandidate({
      childScopes: [
        { childOrder: 1, title: "A", summary: "", acceptanceCriteriaIndices: [0, 1, 2], dependsOn: [] },
        { childOrder: 3, title: "B", summary: "", acceptanceCriteriaIndices: [3, 4], dependsOn: [] },
      ],
    });
    const result = validateCandidate(candidate, makeDoc());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failures.map((f) => f.code)).toContain("non-sequential-child-order");
  });

  it("rejects self-dependency", () => {
    const candidate = makeCandidate({
      childScopes: [
        { childOrder: 1, title: "A", summary: "", acceptanceCriteriaIndices: [0, 1, 2], dependsOn: [1] },
        { childOrder: 2, title: "B", summary: "", acceptanceCriteriaIndices: [3, 4], dependsOn: [] },
      ],
    });
    const result = validateCandidate(candidate, makeDoc());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failures.map((f) => f.code)).toContain("self-dependency");
  });

  it("rejects dependency targeting missing childOrder", () => {
    const candidate = makeCandidate({
      childScopes: [
        { childOrder: 1, title: "A", summary: "", acceptanceCriteriaIndices: [0, 1, 2], dependsOn: [] },
        { childOrder: 2, title: "B", summary: "", acceptanceCriteriaIndices: [3, 4], dependsOn: [99] },
      ],
    });
    const result = validateCandidate(candidate, makeDoc());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failures.map((f) => f.code)).toContain("missing-dependency-target");
  });

  it("rejects dependency cycles", () => {
    const candidate = makeCandidate({
      childScopes: [
        { childOrder: 1, title: "A", summary: "", acceptanceCriteriaIndices: [0, 1], dependsOn: [3] },
        { childOrder: 2, title: "B", summary: "", acceptanceCriteriaIndices: [2], dependsOn: [1] },
        { childOrder: 3, title: "C", summary: "", acceptanceCriteriaIndices: [3, 4], dependsOn: [2] },
      ],
    });
    const result = validateCandidate(candidate, makeDoc());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failures.map((f) => f.code)).toContain("dependency-cycle");
  });

  it("rejects empty child title", () => {
    const candidate = makeCandidate({
      childScopes: [
        { childOrder: 1, title: "", summary: "", acceptanceCriteriaIndices: [0, 1, 2], dependsOn: [] },
        { childOrder: 2, title: "B", summary: "", acceptanceCriteriaIndices: [3, 4], dependsOn: [] },
      ],
    });
    const result = validateCandidate(candidate, makeDoc());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failures.map((f) => f.code)).toContain("empty-title");
  });

  it("rejects empty rationale", () => {
    const candidate = makeCandidate({ rationale: "  " });
    const result = validateCandidate(candidate, makeDoc());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failures.map((f) => f.code)).toContain("empty-rationale");
  });

  it("rejects empty child scope (no ACs assigned)", () => {
    const candidate = makeCandidate({
      childScopes: [
        { childOrder: 1, title: "A", summary: "", acceptanceCriteriaIndices: [0, 1, 2, 3, 4], dependsOn: [] },
        { childOrder: 2, title: "B", summary: "", acceptanceCriteriaIndices: [], dependsOn: [] },
      ],
    });
    const result = validateCandidate(candidate, makeDoc());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failures.map((f) => f.code)).toContain("empty-child-scope");
  });
});

describe("candidateToChildDesignDocs", () => {
  it("derives child designDocs with the right AC subsets and sorted order", () => {
    const doc = makeDoc();
    const candidate = makeCandidate({
      childScopes: [
        // Deliberately scrambled to test sort.
        { childOrder: 2, title: "Record usage", summary: "Mark parts used.", acceptanceCriteriaIndices: [1, 2], dependsOn: [1] },
        { childOrder: 1, title: "Read", summary: "Show parts.", acceptanceCriteriaIndices: [0], dependsOn: [] },
        { childOrder: 3, title: "Low-stock", summary: "Restock view.", acceptanceCriteriaIndices: [3, 4], dependsOn: [1, 2] },
      ],
    });
    const docs = candidateToChildDesignDocs(candidate, doc);
    expect(docs.map((d) => d.childOrder)).toEqual([1, 2, 3]);
    expect(docs[0]!.designDoc.acceptanceCriteria).toEqual(["AC1: Tech sees truck inventory."]);
    expect(docs[1]!.designDoc.acceptanceCriteria).toEqual([
      "AC2: Tech records usage.",
      "AC3: Idempotency on usage POST.",
    ]);
    expect(docs[2]!.designDoc.acceptanceCriteria).toEqual([
      "AC4: Low-stock badge on UI.",
      "AC5: Dispatch rollup view.",
    ]);
  });

  it("uses the child scope's summary as proposedApproach when present", () => {
    const docs = candidateToChildDesignDocs(makeCandidate(), makeDoc());
    expect(docs[0]!.designDoc.proposedApproach).toBe("Show parts on each truck.");
  });

  it("falls back to the parent's proposedApproach when scope summary is empty", () => {
    const candidate = makeCandidate({
      childScopes: [
        { childOrder: 1, title: "A", summary: "", acceptanceCriteriaIndices: [0, 1, 2], dependsOn: [] },
        { childOrder: 2, title: "B", summary: "", acceptanceCriteriaIndices: [3, 4], dependsOn: [] },
      ],
    });
    const docs = candidateToChildDesignDocs(candidate, makeDoc());
    expect(docs[0]!.designDoc.proposedApproach).toBe("Inventory list + usage POST + low-stock badge.");
  });

  it("preserves parent's problemStatement and reusePlan on every child", () => {
    const docs = candidateToChildDesignDocs(makeCandidate(), makeDoc());
    for (const d of docs) {
      expect(d.designDoc.problemStatement).toBe("Stop techs driving back to the warehouse.");
      expect(d.designDoc.reusePlan).toBe("No existing inventory substrate.");
    }
  });
});

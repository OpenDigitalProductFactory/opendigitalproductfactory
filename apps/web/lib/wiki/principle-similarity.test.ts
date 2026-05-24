// Phase 1 Task 1.8 of the principles-as-wiki-kind plan: similarity-based
// detectors for duplicates and contradictions. Pure functions that take
// pre-computed direction embeddings — the orchestrator generates them.
//
// Spec: docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md §14
// Plan: docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md (Phase 1 Task 1.8)

import { describe, expect, it } from "vitest";
import {
  detectPrincipleDuplicate,
  detectPrincipleContradictionReview,
} from "./principle-similarity";
import type { LintPrincipleWikiPage } from "./principle-lint-detectors";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePage(
  id: string,
  title: string,
  overrides: Partial<LintPrincipleWikiPage> = {},
): LintPrincipleWikiPage {
  return {
    id,
    slug: `principles/${id}`,
    title,
    body: "## Rule\n\n...",
    pageKind: "principle",
    status: "published",
    isKernel: true,
    kernelVersion: "0.2.0",
    organizationId: null,
    kernelPageId: null,
    derivedFromKernelVersion: null,
    principleTier: "core",
    principleDirection: "Prefer X over Y.",
    principleWeight: null,
    principleWeightRationale: null,
    principleDimensionVector: null,
    principleDimensions: [],
    principleAppliesTo: ["in_platform_coworker"],
    principlePublic: false,
    principlePublicRationale: null,
    principleRuntimeEnforcement: null,
    lastReviewedAt: null,
    ...overrides,
  };
}

// Unit-length vectors so cosine similarity equals dot product.
function unitVector(dim: number, primaryIdx: number, primaryWeight: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[primaryIdx] = primaryWeight;
  const otherIdx = (primaryIdx + 1) % dim;
  const otherWeight = Math.sqrt(1 - primaryWeight * primaryWeight);
  v[otherIdx] = otherWeight;
  return v;
}

// ─── detectPrincipleDuplicate ───────────────────────────────────────────────

describe("detectPrincipleDuplicate", () => {
  it("flags a near-duplicate pair (cosine > 0.9 AND >= 3 stemmed shared title words) on the newer page", () => {
    // Two near-identical unit vectors — cosine ~ 0.999
    const v = [1, 0, 0, 0];
    const findings = detectPrincipleDuplicate({
      pages: [
        makePage("older", "Prefer architecture over shortcut speed always", {
          lastReviewedAt: new Date(2026, 0, 1),
        }),
        makePage("newer", "Prefer architecture over shortcut speed everytime", {
          lastReviewedAt: new Date(2026, 4, 1),
        }),
      ],
      embeddings: new Map([
        ["older", v],
        ["newer", v],
      ]),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].pageId).toBe("newer");
    expect(findings[0].findingKind).toBe("principle-duplicate");
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].detail).toMatchObject({ blocksPublish: false });
    expect(findings[0].detail).toMatchObject({ duplicateOf: "older" });
  });

  it("does NOT flag pairs whose cosine is below 0.9 even with overlapping titles", () => {
    // Orthogonal-ish vectors — cosine ~ 0
    const v1 = [1, 0, 0, 0];
    const v2 = [0, 1, 0, 0];
    const findings = detectPrincipleDuplicate({
      pages: [
        makePage("a", "architecture over shortcuts always", {
          lastReviewedAt: new Date(2026, 0, 1),
        }),
        makePage("b", "architecture over shortcuts everywhere", {
          lastReviewedAt: new Date(2026, 4, 1),
        }),
      ],
      embeddings: new Map([
        ["a", v1],
        ["b", v2],
      ]),
    });
    expect(findings).toEqual([]);
  });

  it("does NOT flag pairs whose titles share fewer than 3 stemmed words even with high cosine", () => {
    const v = [1, 0, 0, 0];
    const findings = detectPrincipleDuplicate({
      pages: [
        makePage("a", "Architecture matters", {
          lastReviewedAt: new Date(2026, 0, 1),
        }),
        makePage("b", "Evidence before action", {
          lastReviewedAt: new Date(2026, 4, 1),
        }),
      ],
      embeddings: new Map([
        ["a", v],
        ["b", v],
      ]),
    });
    expect(findings).toEqual([]);
  });

  it("skips pages with no embedding available (silently — orchestrator handles missing-embedding warnings elsewhere)", () => {
    const v = [1, 0, 0, 0];
    const findings = detectPrincipleDuplicate({
      pages: [
        makePage("a", "architecture maintainability schema speed"),
        makePage("b", "architecture maintainability schema speed"),
      ],
      embeddings: new Map([["a", v]]), // b missing
    });
    expect(findings).toEqual([]);
  });

  it("attaches the finding to the newer page (by lastReviewedAt); falls back to id-desc when timestamps tie or are null", () => {
    const v = [1, 0, 0, 0];

    // Both null → id desc means "z_page" wins, "a_page" is the older / kept
    const findings = detectPrincipleDuplicate({
      pages: [
        makePage("a_page", "architecture maintainability schema speed"),
        makePage("z_page", "architecture maintainability schema speed"),
      ],
      embeddings: new Map([
        ["a_page", v],
        ["z_page", v],
      ]),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].pageId).toBe("z_page");
    expect(findings[0].detail).toMatchObject({ duplicateOf: "a_page" });
  });

  it("ignores non-principle pages entirely", () => {
    const v = [1, 0, 0, 0];
    const findings = detectPrincipleDuplicate({
      pages: [
        {
          ...makePage("a", "architecture maintainability schema speed"),
          pageKind: "stance",
        },
        makePage("b", "architecture maintainability schema speed"),
      ],
      embeddings: new Map([
        ["a", v],
        ["b", v],
      ]),
    });
    expect(findings).toEqual([]);
  });
});

// ─── detectPrincipleContradictionReview ────────────────────────────────────

describe("detectPrincipleContradictionReview", () => {
  it("flags pairs with at least one shared-dimension sign opposition AND cosine > 0.75 — both pages get findings", () => {
    const v = unitVector(4, 0, 0.9); // near-identical → cosine very high
    const findings = detectPrincipleContradictionReview({
      pages: [
        makePage("a", "Favor speed", {
          principleDimensionVector: { speed_to_value: 1, schema_grounding: 0.5 },
          principleDimensions: ["speed_to_value", "schema_grounding"],
        }),
        makePage("b", "Favor maintainability", {
          principleDimensionVector: {
            speed_to_value: -0.8,
            schema_grounding: 0.5,
          },
          principleDimensions: ["speed_to_value", "schema_grounding"],
        }),
      ],
      embeddings: new Map([
        ["a", v],
        ["b", v],
      ]),
    });

    expect(findings).toHaveLength(2);
    const pageIds = findings.map((f) => f.pageId).sort();
    expect(pageIds).toEqual(["a", "b"]);
    for (const f of findings) {
      expect(f.findingKind).toBe("principle-contradiction-review");
      expect(f.severity).toBe("warn");
      expect(f.detail).toMatchObject({ blocksPublish: false });
      expect(f.detail).toMatchObject({
        opposingDimensions: ["speed_to_value"],
      });
    }
  });

  it("does NOT flag pairs whose shared dimensions all align in sign (same direction)", () => {
    const v = [1, 0, 0, 0];
    const findings = detectPrincipleContradictionReview({
      pages: [
        makePage("a", "A", {
          principleDimensionVector: { speed_to_value: 1, schema_grounding: 0.5 },
          principleDimensions: ["speed_to_value", "schema_grounding"],
        }),
        makePage("b", "B", {
          principleDimensionVector: {
            speed_to_value: 0.8,
            schema_grounding: 0.5,
          },
          principleDimensions: ["speed_to_value", "schema_grounding"],
        }),
      ],
      embeddings: new Map([
        ["a", v],
        ["b", v],
      ]),
    });
    expect(findings).toEqual([]);
  });

  it("does NOT flag opposing signs when direction cosine is below 0.75 (different principles can pull opposite ways)", () => {
    // Orthogonal vectors → cosine = 0, well below 0.75
    const v1 = [1, 0, 0, 0];
    const v2 = [0, 1, 0, 0];
    const findings = detectPrincipleContradictionReview({
      pages: [
        makePage("a", "A", {
          principleDimensionVector: { speed_to_value: 1 },
          principleDimensions: ["speed_to_value"],
        }),
        makePage("b", "B", {
          principleDimensionVector: { speed_to_value: -1 },
          principleDimensions: ["speed_to_value"],
        }),
      ],
      embeddings: new Map([
        ["a", v1],
        ["b", v2],
      ]),
    });
    expect(findings).toEqual([]);
  });

  it("does NOT flag pairs with no shared dimensions even when embeddings are near-duplicates", () => {
    const v = [1, 0, 0, 0];
    const findings = detectPrincipleContradictionReview({
      pages: [
        makePage("a", "A", {
          principleDimensionVector: { speed_to_value: 1 },
          principleDimensions: ["speed_to_value"],
        }),
        makePage("b", "B", {
          principleDimensionVector: { long_term_maintainability: 1 },
          principleDimensions: ["long_term_maintainability"],
        }),
      ],
      embeddings: new Map([
        ["a", v],
        ["b", v],
      ]),
    });
    expect(findings).toEqual([]);
  });

  it("treats a near-zero value as neutral (no sign opposition with a strong positive)", () => {
    // 0.05 vs 1.0 — both non-negative, no opposition
    const v = [1, 0, 0, 0];
    const findings = detectPrincipleContradictionReview({
      pages: [
        makePage("a", "A", {
          principleDimensionVector: { speed_to_value: 1 },
          principleDimensions: ["speed_to_value"],
        }),
        makePage("b", "B", {
          principleDimensionVector: { speed_to_value: 0.05 },
          principleDimensions: ["speed_to_value"],
        }),
      ],
      embeddings: new Map([
        ["a", v],
        ["b", v],
      ]),
    });
    expect(findings).toEqual([]);
  });
});

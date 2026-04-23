// apps/web/lib/deliberation/evidence.test.ts
// Task 5 — Evidence policy tests (spec §8).
//
// Covers:
//   - Grade D claims cannot enter a final outcome
//   - source-sensitive artifact types require citations
//   - source locators serialize as structured locators, not loose URLs
//   - fact-vs-inference split + evidence badge computation
//   - deliberation retrieval events mirror into ExternalEvidenceRecord

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the external-evidence Prisma action so the mirror helper can be
// asserted without touching the database. The mock must be installed before
// the module under test imports it.
vi.mock("../actions/external-evidence", () => ({
  recordExternalEvidence: vi.fn(),
}));

import { recordExternalEvidence } from "../actions/external-evidence";
import {
  checkAdmissibility,
  computeEvidenceBadge,
  mirrorDeliberationRetrievalEvent,
  normalizeLocator,
  splitFactsVsInferences,
} from "./evidence";
import type { StructuredLocator } from "./evidence";

const mockRecord = vi.mocked(recordExternalEvidence);

describe("deliberation evidence — checkAdmissibility", () => {
  const strictPattern = {
    retrievalRequired: true,
    admissibleSourceTypes: ["code", "spec", "doc"] as const,
  };

  it("rejects Grade D in a final outcome rationale", () => {
    const result = checkAdmissibility({
      artifactType: "spec",
      grade: "D",
      pattern: {
        retrievalRequired: true,
        admissibleSourceTypes: ["spec"],
      },
      sourceType: "spec",
      isFinalRationale: true,
    });
    expect(result.admissible).toBe(false);
    expect(result.reason).toMatch(/grade d/i);
  });

  it("permits Grade D as a hypothesis outside a final outcome", () => {
    const result = checkAdmissibility({
      artifactType: "spec",
      grade: "D",
      pattern: {
        retrievalRequired: true,
        admissibleSourceTypes: ["spec"],
      },
      sourceType: "spec",
      isFinalRationale: false,
    });
    expect(result.admissible).toBe(true);
  });

  it("rejects when sourceType is not in admissibleSourceTypes", () => {
    const result = checkAdmissibility({
      artifactType: "code-change",
      grade: "A",
      pattern: {
        retrievalRequired: true,
        admissibleSourceTypes: ["code"],
      },
      sourceType: "web",
      isFinalRationale: true,
    });
    expect(result.admissible).toBe(false);
    expect(result.reason).toMatch(/sourcetype/i);
  });

  it("rejects when retrievalRequired is true but sourceType is missing in a final rationale", () => {
    const result = checkAdmissibility({
      artifactType: "spec",
      grade: "B",
      pattern: strictPattern,
      isFinalRationale: true,
    });
    expect(result.admissible).toBe(false);
    expect(result.reason).toMatch(/retrieval/i);
  });

  it("permits Grade A for source-sensitive artifactType=code-change", () => {
    const result = checkAdmissibility({
      artifactType: "code-change",
      grade: "A",
      pattern: {
        retrievalRequired: true,
        admissibleSourceTypes: ["code"],
      },
      sourceType: "code",
      isFinalRationale: true,
    });
    expect(result.admissible).toBe(true);
  });

  it("permits Grade B for source-sensitive artifactType=spec", () => {
    const result = checkAdmissibility({
      artifactType: "spec",
      grade: "B",
      pattern: {
        retrievalRequired: true,
        admissibleSourceTypes: ["spec", "doc"],
      },
      sourceType: "doc",
      isFinalRationale: true,
    });
    expect(result.admissible).toBe(true);
  });

  it("rejects Grade C for source-sensitive artifacts in final rationale", () => {
    const result = checkAdmissibility({
      artifactType: "policy",
      grade: "C",
      pattern: {
        retrievalRequired: true,
        admissibleSourceTypes: ["spec", "doc"],
      },
      sourceType: "doc",
      isFinalRationale: true,
    });
    expect(result.admissible).toBe(false);
    expect(result.reason).toMatch(/source-sensitive/i);
  });

  it("permits Grade C for non-source-sensitive artifacts (e.g. research-question)", () => {
    const result = checkAdmissibility({
      artifactType: "research-question",
      grade: "C",
      pattern: {
        retrievalRequired: false,
        admissibleSourceTypes: ["doc", "web"],
      },
      sourceType: "doc",
      isFinalRationale: true,
    });
    expect(result.admissible).toBe(true);
  });
});

describe("deliberation evidence — normalizeLocator", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("refuses a loose URL string (citation-theater risk)", () => {
    const result = normalizeLocator("https://example.com/some-article");
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("accepts a valid code locator", () => {
    const loc: StructuredLocator = {
      sourceType: "code",
      filePath: "apps/web/lib/foo.ts",
      line: 42,
      commit: "abc1234",
    };
    expect(normalizeLocator(loc)).toEqual(loc);
  });

  it("accepts a valid spec locator", () => {
    const loc: StructuredLocator = {
      sourceType: "spec",
      path: "docs/superpowers/specs/2026-04-21-deliberation-pattern-framework-design.md",
      heading: "§8 Evidence",
    };
    expect(normalizeLocator(loc)).toEqual(loc);
  });

  it("accepts a valid doc locator", () => {
    const loc: StructuredLocator = {
      sourceType: "doc",
      path: "docs/foo.md",
    };
    expect(normalizeLocator(loc)).toEqual(loc);
  });

  it("accepts a valid paper locator", () => {
    const loc: StructuredLocator = {
      sourceType: "paper",
      doi: "10.1234/example",
      page: 3,
    };
    expect(normalizeLocator(loc)).toEqual(loc);
  });

  it("accepts a valid web locator with required retrievedAt", () => {
    const loc: StructuredLocator = {
      sourceType: "web",
      url: "https://example.com/x",
      title: "X",
      retrievedAt: "2026-04-22T12:00:00Z",
    };
    expect(normalizeLocator(loc)).toEqual(loc);
  });

  it("rejects a web locator missing url", () => {
    const result = normalizeLocator({
      sourceType: "web",
      retrievedAt: "2026-04-22T12:00:00Z",
    });
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("rejects a web locator missing retrievedAt", () => {
    const result = normalizeLocator({
      sourceType: "web",
      url: "https://example.com/x",
    });
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("accepts a valid db-query locator", () => {
    const loc: StructuredLocator = {
      sourceType: "db-query",
      entity: "FeatureBuild",
      query: "id=abc",
      capturedAt: "2026-04-22T12:00:00Z",
    };
    expect(normalizeLocator(loc)).toEqual(loc);
  });

  it("accepts a valid tool-output locator", () => {
    const loc: StructuredLocator = {
      sourceType: "tool-output",
      toolName: "browse_extract",
      parameterHash: "sha256:deadbeef",
      resultRef: "run-123:output-4",
    };
    expect(normalizeLocator(loc)).toEqual(loc);
  });

  it("accepts a valid runtime-state locator", () => {
    const loc: StructuredLocator = {
      sourceType: "runtime-state",
      snapshotKey: "build-studio:phase=review",
      capturedAt: "2026-04-22T12:00:00Z",
    };
    expect(normalizeLocator(loc)).toEqual(loc);
  });

  it("rejects an unknown sourceType", () => {
    const result = normalizeLocator({ sourceType: "blog-post", url: "x" });
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("rejects null", () => {
    expect(normalizeLocator(null)).toBeNull();
  });

  it("rejects a code locator missing filePath", () => {
    const result = normalizeLocator({ sourceType: "code", line: 1 });
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("deliberation evidence — splitFactsVsInferences", () => {
  it("classifies Grade A/B as facts and C/D as inferences", () => {
    const split = splitFactsVsInferences([
      { claimId: "c1", grade: "A" },
      { claimId: "c2", grade: "B" },
      { claimId: "c3", grade: "C" },
      { claimId: "c4", grade: "D" },
    ]);
    expect(split.facts).toEqual([
      { claimId: "c1", grade: "A" },
      { claimId: "c2", grade: "B" },
    ]);
    expect(split.inferences).toEqual([
      { claimId: "c3", grade: "C" },
      { claimId: "c4", grade: "D" },
    ]);
  });

  it("returns empty arrays for empty input", () => {
    expect(splitFactsVsInferences([])).toEqual({ facts: [], inferences: [] });
  });
});

describe("deliberation evidence — computeEvidenceBadge", () => {
  it("returns source-backed when all claims are Grade A or B", () => {
    expect(computeEvidenceBadge([{ grade: "A" }, { grade: "B" }])).toBe(
      "source-backed",
    );
  });

  it("returns mixed when some claims are A/B and some C/D", () => {
    expect(computeEvidenceBadge([{ grade: "A" }, { grade: "C" }])).toBe("mixed");
  });

  it("returns needs-more-evidence when all claims are C or D", () => {
    expect(computeEvidenceBadge([{ grade: "C" }, { grade: "D" }])).toBe(
      "needs-more-evidence",
    );
  });

  it("returns needs-more-evidence when there are no claims", () => {
    expect(computeEvidenceBadge([])).toBe("needs-more-evidence");
  });
});

describe("deliberation evidence — mirrorDeliberationRetrievalEvent", () => {
  beforeEach(() => {
    mockRecord.mockReset();
  });

  it("delegates to recordExternalEvidence with deliberation route context and retrieve op", async () => {
    mockRecord.mockResolvedValue({ id: "ext-1" } as any);

    await mirrorDeliberationRetrievalEvent({
      actorUserId: "user-1",
      deliberationRunId: "run-42",
      target: "docs/superpowers/specs/evidence.md",
      provider: "read-file",
      resultSummary: "Read §8 Evidence policy",
    });

    expect(mockRecord).toHaveBeenCalledTimes(1);
    const call = mockRecord.mock.calls[0][0];
    expect(call.actorUserId).toBe("user-1");
    expect(call.routeContext).toBe("deliberation");
    expect(call.operationType).toBe("retrieve");
    expect(call.target).toBe("docs/superpowers/specs/evidence.md");
    expect(call.provider).toBe("read-file");
    expect(call.resultSummary).toBe("Read §8 Evidence policy");
    // deliberationRunId travels as details so we keep a back-reference
    expect(call.details).toMatchObject({ deliberationRunId: "run-42" });
  });
});

import { describe, expect, it } from "vitest";

import {
  evaluateCompletionEvidence,
  type CompletionEvidenceFact,
  type CompletionEvidencePolicyInput,
} from "./completion-evidence-policy";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const CUTOFF = new Date("2026-07-25T12:00:00.000Z");

function fact(
  id: string,
  evidenceKind: CompletionEvidenceFact["evidenceKind"],
  recordedAt = new Date("2026-07-26T10:00:00.000Z"),
  itemId = "row-1",
): CompletionEvidenceFact {
  return { id, itemId, evidenceKind, recordedAt, structurallyValid: true };
}

function input(overrides: Partial<CompletionEvidencePolicyInput> = {}): CompletionEvidencePolicyInput {
  return {
    item: { id: "row-1", itemId: "BI-1", status: "in-progress", workType: "feature" },
    rawManifest: {
      workClass: "implementation",
      evidenceActivityIds: ["source", "tests", "build"],
      ux: { disposition: "not-applicable", reason: "No user interface files or routes changed." },
      migration: { disposition: "not-applicable", reason: "No database schema or persisted data changed." },
    },
    evidence: [
      fact("source", "source_verified"),
      fact("tests", "test_pass"),
      fact("build", "build_pass"),
    ],
    activeBuildEvidence: null,
    evidenceCutoff: CUTOFF,
    now: NOW,
    ...overrides,
  };
}

describe("evaluateCompletionEvidence", () => {
  it("allows a proportionate implementation manifest", () => {
    expect(evaluateCompletionEvidence(input())).toMatchObject({
      allowed: true,
      normalizedManifest: { workClass: "implementation" },
      blockers: [],
    });
  });

  it("allows documentation with a fresh spec review", () => {
    const result = evaluateCompletionEvidence(input({
      item: { id: "row-1", itemId: "BI-DOC", status: "open", workType: "doc" },
      rawManifest: {
        workClass: "documentation",
        evidenceActivityIds: ["spec"],
      },
      evidence: [fact("spec", "spec_review")],
    }));
    expect(result.allowed).toBe(true);
  });

  it("returns only valid cited manual or UX evidence as substantive acceptance refs", () => {
    const result = evaluateCompletionEvidence(input({
      item: { id: "row-1", itemId: "BI-DOC", status: "open", workType: "doc" },
      rawManifest: {
        workClass: "documentation",
        evidenceActivityIds: ["spec", "manual", "ux"],
      },
      evidence: [
        fact("spec", "spec_review"),
        fact("manual", "manual_check"),
        fact("ux", "ux_verified"),
      ],
    }));

    expect(result).toMatchObject({
      allowed: true,
      acceptanceEvidenceRefs: ["manual", "ux"],
    });
  });

  it("does not return stale UX acceptance when a newer UX failure exists", () => {
    const result = evaluateCompletionEvidence(input({
      item: { id: "row-1", itemId: "BI-DOC", status: "open", workType: "doc" },
      rawManifest: {
        workClass: "documentation",
        evidenceActivityIds: ["spec", "ux-pass"],
      },
      evidence: [
        fact("spec", "spec_review"),
        fact("ux-pass", "ux_verified", new Date("2026-07-26T09:00:00.000Z")),
        fact("ux-fail", "ux_fail", new Date("2026-07-26T11:00:00.000Z")),
      ],
    }));

    expect(result.allowed).toBe(true);
    expect(result.acceptanceEvidenceRefs).toEqual([]);
  });

  it("allows verified-existing work with source and manual verification", () => {
    const result = evaluateCompletionEvidence(input({
      rawManifest: {
        workClass: "verified-existing",
        evidenceActivityIds: ["source", "manual"],
      },
      evidence: [fact("source", "source_verified"), fact("manual", "manual_check")],
    }));
    expect(result.allowed).toBe(true);
  });

  it("allows operational chores without forcing code gates", () => {
    const result = evaluateCompletionEvidence(input({
      item: { id: "row-1", itemId: "BI-OPS", status: "open", workType: "chore" },
      rawManifest: {
        workClass: "operational",
        evidenceActivityIds: ["manual"],
      },
      evidence: [fact("manual", "manual_check")],
    }));
    expect(result.allowed).toBe(true);
  });

  it("prevents implementation work from masquerading as documentation", () => {
    const result = evaluateCompletionEvidence(input({
      rawManifest: { workClass: "documentation", evidenceActivityIds: ["spec"] },
      evidence: [fact("spec", "spec_review")],
    }));
    expect(result.allowed).toBe(false);
    expect(result.blockers.map((blocker) => blocker.code)).toContain("incompatible-work-class");
  });

  it("requires concrete UX and migration not-applicable reasons", () => {
    const result = evaluateCompletionEvidence(input({
      rawManifest: {
        workClass: "implementation",
        evidenceActivityIds: ["source", "tests", "build"],
        ux: { disposition: "not-applicable", reason: "none" },
        migration: { disposition: "not-applicable", reason: "" },
      },
    }));
    expect(result.allowed).toBe(false);
    expect(result.blockers.map((blocker) => blocker.dimension)).toEqual(
      expect.arrayContaining(["ux", "migration"]),
    );
  });

  it("requires UX and migration evidence when declared verified", () => {
    const result = evaluateCompletionEvidence(input({
      rawManifest: {
        workClass: "implementation",
        evidenceActivityIds: ["source", "tests", "build"],
        ux: { disposition: "verified" },
        migration: { disposition: "verified" },
      },
    }));
    expect(result.allowed).toBe(false);
    expect(result.blockers.map((blocker) => blocker.dimension)).toEqual(
      expect.arrayContaining(["ux", "migration"]),
    );
  });

  it("rejects foreign and stale evidence references", () => {
    const result = evaluateCompletionEvidence(input({
      evidence: [
        fact("source", "source_verified", new Date("2026-07-26T10:00:00Z"), "another-row"),
        fact("tests", "test_pass", new Date("2026-07-20T10:00:00Z")),
        fact("build", "build_pass"),
      ],
    }));
    expect(result.allowed).toBe(false);
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(["foreign-evidence", "stale-evidence"]),
    );
  });

  it("rejects a dangling evidence reference", () => {
    const result = evaluateCompletionEvidence(input({
      evidence: [fact("source", "source_verified"), fact("tests", "test_pass")],
    }));
    expect(result.allowed).toBe(false);
    expect(result.blockers.map((blocker) => blocker.code)).toContain("missing-evidence-reference");
  });

  it("lets a newer failure invalidate an older referenced pass", () => {
    const result = evaluateCompletionEvidence(input({
      evidence: [
        fact("source", "source_verified"),
        fact("tests", "test_pass", new Date("2026-07-26T09:00:00Z")),
        fact("build", "build_pass"),
        fact("latest-test", "test_fail", new Date("2026-07-26T11:00:00Z")),
      ],
    }));
    expect(result.allowed).toBe(false);
    expect(result.blockers).toContainEqual(expect.objectContaining({
      code: "newer-failure",
      dimension: "unit-tests",
    }));
  });

  it("uses active Build Studio evidence only for dimensions it proves", () => {
    const allowed = evaluateCompletionEvidence(input({
      rawManifest: {
        workClass: "implementation",
        evidenceActivityIds: ["source"],
        useActiveBuildEvidence: true,
        ux: { disposition: "verified" },
        migration: { disposition: "not-applicable", reason: "No database schema or persisted data changed." },
      },
      evidence: [fact("source", "source_verified")],
      activeBuildEvidence: {
        testsPassed: true,
        productionBuildPassed: true,
        ux: "verified",
      },
    }));
    expect(allowed.allowed).toBe(true);

    const skipped = evaluateCompletionEvidence(input({
      rawManifest: {
        workClass: "implementation",
        evidenceActivityIds: ["source"],
        useActiveBuildEvidence: true,
        ux: { disposition: "verified" },
        migration: { disposition: "not-applicable", reason: "No database schema or persisted data changed." },
      },
      evidence: [fact("source", "source_verified")],
      activeBuildEvidence: {
        testsPassed: true,
        productionBuildPassed: true,
        ux: "skipped",
      },
    }));
    expect(skipped.allowed).toBe(false);
    expect(skipped.blockers).toContainEqual(expect.objectContaining({ dimension: "ux" }));
  });

  it("keeps an already-done transition idempotent without new evidence", () => {
    const result = evaluateCompletionEvidence(input({
      item: { id: "row-1", itemId: "BI-1", status: "done", workType: "feature" },
      rawManifest: null,
      evidence: [],
    }));
    expect(result).toMatchObject({ allowed: true, noOp: true, blockers: [] });
  });
});
